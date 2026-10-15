//! Conclave MCP stdio bridge — native, zero runtime dependencies.
//!
//! This is the Rust twin of `orchestrator/bin/mcp-server.js`: it reads
//! newline-delimited JSON-RPC messages from stdin and forwards each one to the
//! running Conclave orchestrator over HTTP, writing the response body back to
//! stdout. The default endpoint is `http://127.0.0.1:4000/mcp`, overridable with
//! `CONCLAVE_MCP_URL`.
//!
//! It is compiled directly by `rustc -O crates/conclave-mcp/src/main.rs -o <out>`
//! (see `scripts/build-sidecar.ts`), so it must stay a single stdlib-only file:
//! no `Cargo.toml`, no crates, no async runtime, no TLS.

use std::io::{self, BufRead, Read, Write};
use std::net::TcpStream;
use std::time::Duration;

const DEFAULT_URL: &str = "http://127.0.0.1:4000/mcp";

fn main() {
    let url = std::env::var("CONCLAVE_MCP_URL").unwrap_or_else(|_| DEFAULT_URL.to_string());
    let endpoint = match parse_url(&url) {
        Ok(endpoint) => endpoint,
        Err(err) => {
            // A broken URL would fail every request. Say why once, then keep going
            // against the documented default so a typo cannot brick the bridge.
            eprintln!("[conclave-mcp] invalid CONCLAVE_MCP_URL {url:?}: {err}");
            match parse_url(DEFAULT_URL) {
                Ok(endpoint) => endpoint,
                Err(_) => return,
            }
        }
    };

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                eprintln!("[conclave-mcp] stdin read error: {err}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue; // blank lines are not messages
        }
        handle_line(trimmed, &endpoint, &mut stdout);
    }
}

/// Forward one JSON-RPC message and write its reply, if it expects one.
fn handle_line(body: &str, endpoint: &Endpoint, out: &mut impl Write) {
    let id = match top_level_id(body) {
        Ok(id) => id,
        Err(_) => {
            // Not a JSON object: JSON-RPC parse error (-32700). The id is
            // unknowable, so it is null — same as the JS bridge does.
            write_error(out, "null", -32700, "Parse error");
            return;
        }
    };

    // A JSON-RPC notification carries no `id` (or an explicit null) and never
    // gets a reply, whether the forward succeeds or fails.
    let is_notification = matches!(id, IdInfo::Absent | IdInfo::Null);
    let id_literal = match &id {
        IdInfo::Raw(raw) => raw.clone(),
        _ => "null".to_string(),
    };

    match post(endpoint, body) {
        Ok(response) => {
            if is_notification {
                return;
            }
            if response.status == 204 {
                return; // No Content: nothing to forward
            }
            if !(200..300).contains(&response.status) {
                let message = format!(
                    "Conclave HTTP {} from {}: {}",
                    response.status,
                    endpoint.url,
                    snippet(&response.body)
                );
                write_error(out, &id_literal, -32000, &message);
                return;
            }
            if let Err(err) = validate_json(&response.body) {
                // A 2xx body we cannot even parse is a failure, not a result: a
                // pass-through would hand the client garbage.
                let message =
                    format!("Unparsable JSON response from {}: {err}", endpoint.url);
                write_error(out, &id_literal, -32000, &message);
                return;
            }
            // Forward the orchestrator's body verbatim, byte for byte.
            let _ = out.write_all(response.body.as_bytes());
            let _ = out.write_all(b"\n");
            let _ = out.flush();
        }
        Err(err) => {
            if is_notification {
                return;
            }
            let message = format!(
                "Cannot connect to Conclave orchestrator at {}: {err}",
                endpoint.url
            );
            write_error(out, &id_literal, -32000, &message);
        }
    }
}

/// Emit a well-formed JSON-RPC error object, then a newline, then flush.
///
/// Every failure path funnels through here so a client never sees an empty line
/// and hangs waiting for a response that will not come.
fn write_error(out: &mut impl Write, id_literal: &str, code: i64, message: &str) {
    let json = format!(
        "{{\"jsonrpc\":\"2.0\",\"id\":{id},\"error\":{{\"code\":{code},\"message\":\"{msg}\"}}}}",
        id = id_literal,
        code = code,
        msg = json_escape(message),
    );
    let _ = out.write_all(json.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

// ---------------------------------------------------------------------------
// HTTP/1.1 over a plain TcpStream
// ---------------------------------------------------------------------------

struct Endpoint {
    /// The URL as given, echoed back in error messages.
    url: String,
    host: String,
    port: u16,
    path: String,
}

struct HttpResponse {
    status: u16,
    body: String,
}

fn parse_url(url: &str) -> Result<Endpoint, String> {
    let rest = url.strip_prefix("http://").ok_or_else(|| {
        if url.starts_with("https://") {
            "https is not supported (this bridge has no TLS)".to_string()
        } else {
            format!("unsupported scheme; expected http://, got {url:?}")
        }
    })?;

    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    if authority.is_empty() {
        return Err("missing host".to_string());
    }

    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => {
            let port: u16 = port
                .parse()
                .map_err(|_| format!("invalid port {port:?} in {url:?}"))?;
            (host.to_string(), port)
        }
        None => (authority.to_string(), 80),
    };
    if host.is_empty() {
        return Err("missing host".to_string());
    }

    Ok(Endpoint {
        url: url.to_string(),
        host,
        port,
        path: path.to_string(),
    })
}

fn post(endpoint: &Endpoint, body: &str) -> Result<HttpResponse, String> {
    let mut stream = TcpStream::connect((endpoint.host.as_str(), endpoint.port))
        .map_err(|err| format!("connection failed: {err}"))?;
    // Timeouts keep a wedged server from hanging the client forever.
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));

    let mut request = String::new();
    request.push_str(&format!("POST {} HTTP/1.1\r\n", endpoint.path));
    request.push_str(&format!("Host: {}:{}\r\n", endpoint.host, endpoint.port));
    request.push_str("Content-Type: application/json\r\n");
    request.push_str("Accept: application/json\r\n");
    request.push_str("Origin: http://127.0.0.1:4000\r\n");
    request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    request.push_str("Connection: close\r\n\r\n");

    stream
        .write_all(request.as_bytes())
        .map_err(|err| format!("request write failed: {err}"))?;
    stream
        .write_all(body.as_bytes())
        .map_err(|err| format!("request body write failed: {err}"))?;
    stream
        .flush()
        .map_err(|err| format!("request flush failed: {err}"))?;

    // `Connection: close` means the peer closes when the response is complete,
    // so a read to EOF yields the whole thing.
    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|err| format!("response read failed: {err}"))?;

    parse_http_response(&raw)
}

fn parse_http_response(raw: &[u8]) -> Result<HttpResponse, String> {
    let head_end = find_subslice(raw, b"\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response (no header terminator)".to_string())?;
    let head = std::str::from_utf8(&raw[..head_end])
        .map_err(|_| "malformed HTTP response headers (not UTF-8)".to_string())?;
    let mut body: &[u8] = &raw[head_end + 4..];

    let mut lines = head.split("\r\n");
    let status_line = lines.next().ok_or_else(|| "empty HTTP response".to_string())?;
    let mut parts = status_line.split_whitespace();
    let _version = parts
        .next()
        .ok_or_else(|| format!("bad status line: {status_line:?}"))?;
    let status: u16 = parts
        .next()
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| format!("bad status line: {status_line:?}"))?;

    let mut chunked = false;
    let mut content_length: Option<usize> = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            } else if name == "content-length" {
                content_length = value.parse::<usize>().ok();
            }
        }
    }

    if chunked {
        // A Content-Length-only reader truncates right here: the server delivers
        // the body as hex-sized chunks and deliberately omits the total length.
        let decoded = decode_chunked(body)?;
        return Ok(HttpResponse {
            status,
            body: String::from_utf8_lossy(&decoded).into_owned(),
        });
    }

    if let Some(len) = content_length {
        if len > body.len() {
            // The peer promised more than it sent. Report it rather than guess.
            return Err(format!(
                "truncated response body: expected {len} bytes, got {}",
                body.len()
            ));
        }
        body = &body[..len];
    }

    Ok(HttpResponse {
        status,
        body: String::from_utf8_lossy(body).into_owned(),
    })
}

fn decode_chunked(mut data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let line_end = find_subslice(data, b"\r\n")
            .ok_or_else(|| "truncated chunked body (missing chunk size)".to_string())?;
        let size_line = std::str::from_utf8(&data[..line_end])
            .map_err(|_| "bad chunk size line".to_string())?;
        // Tolerate chunk extensions such as `1a;ext=value`.
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|_| format!("bad chunk size {size_hex:?}"))?;

        data = &data[line_end + 2..];
        if size == 0 {
            break; // last chunk; any trailers after it are ignored
        }
        if data.len() < size {
            return Err("truncated chunked body (chunk shorter than declared)".to_string());
        }
        out.extend_from_slice(&data[..size]);
        data = &data[size..];

        if data.len() >= 2 && &data[..2] == b"\r\n" {
            data = &data[2..];
        } else {
            return Err("truncated chunked body (missing chunk terminator)".to_string());
        }
    }
    Ok(out)
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ---------------------------------------------------------------------------
// Minimal JSON: enough to locate an `id`, and to reject a non-JSON body
// ---------------------------------------------------------------------------

/// The outcome of looking for a top-level `id` member.
enum IdInfo {
    /// The object has no `id` member — a notification.
    Absent,
    /// `id` is null, or a non-scalar (which JSON-RPC forbids but we must not
    /// choke on) — treated as a notification, matching the JS bridge.
    Null,
    /// The raw JSON literal of a scalar `id`, ready to echo back verbatim.
    Raw(String),
}

/// Validate that `body` is a single JSON value.
fn validate_json(body: &str) -> Result<(), String> {
    let bytes = body.as_bytes();
    let mut i = 0;
    skip_ws(bytes, &mut i);
    if i >= bytes.len() {
        return Err("empty body".to_string());
    }
    scan_value(bytes, &mut i, 0)?;
    skip_ws(bytes, &mut i);
    if i != bytes.len() {
        return Err("trailing data after JSON value".to_string());
    }
    Ok(())
}

/// Validate that `body` is a JSON object, and report its `id` member.
fn top_level_id(body: &str) -> Result<IdInfo, String> {
    let bytes = body.as_bytes();
    let mut i = 0;
    skip_ws(bytes, &mut i);
    if i >= bytes.len() || bytes[i] != b'{' {
        return Err("request body is not a JSON object".to_string());
    }
    i += 1;
    let mut id = IdInfo::Absent;

    skip_ws(bytes, &mut i);
    if i < bytes.len() && bytes[i] == b'}' {
        i += 1;
    } else {
        loop {
            skip_ws(bytes, &mut i);
            if i >= bytes.len() || bytes[i] != b'"' {
                return Err("expected an object key".to_string());
            }
            let key_start = i + 1;
            scan_string(bytes, &mut i)?;
            let key = &body[key_start..i - 1];

            skip_ws(bytes, &mut i);
            if i >= bytes.len() || bytes[i] != b':' {
                return Err("expected ':' after object key".to_string());
            }
            i += 1;
            skip_ws(bytes, &mut i);

            let value_start = i;
            scan_value(bytes, &mut i, 1)?;
            let value_raw = body[value_start..i].trim();

            if key == "id" && matches!(id, IdInfo::Absent) {
                id = if value_raw == "null"
                    || value_raw.starts_with('{')
                    || value_raw.starts_with('[')
                {
                    IdInfo::Null
                } else {
                    IdInfo::Raw(value_raw.to_string())
                };
            }

            skip_ws(bytes, &mut i);
            if i >= bytes.len() {
                return Err("unterminated JSON object".to_string());
            }
            match bytes[i] {
                b',' => i += 1,
                b'}' => {
                    i += 1;
                    break;
                }
                _ => return Err("expected ',' or '}' in JSON object".to_string()),
            }
        }
    }

    skip_ws(bytes, &mut i);
    if i != bytes.len() {
        return Err("trailing data after JSON object".to_string());
    }
    Ok(id)
}

fn scan_value(bytes: &[u8], i: &mut usize, depth: u32) -> Result<(), String> {
    if depth > 64 {
        return Err("JSON nesting too deep".to_string());
    }
    skip_ws(bytes, i);
    if *i >= bytes.len() {
        return Err("unexpected end of JSON".to_string());
    }
    match bytes[*i] {
        b'"' => scan_string(bytes, i),
        b'{' => {
            *i += 1;
            skip_ws(bytes, i);
            if *i < bytes.len() && bytes[*i] == b'}' {
                *i += 1;
                return Ok(());
            }
            loop {
                skip_ws(bytes, i);
                if *i >= bytes.len() || bytes[*i] != b'"' {
                    return Err("expected an object key".to_string());
                }
                scan_string(bytes, i)?;
                skip_ws(bytes, i);
                if *i >= bytes.len() || bytes[*i] != b':' {
                    return Err("expected ':' in object".to_string());
                }
                *i += 1;
                scan_value(bytes, i, depth + 1)?;
                skip_ws(bytes, i);
                if *i >= bytes.len() {
                    return Err("unterminated object".to_string());
                }
                match bytes[*i] {
                    b',' => *i += 1,
                    b'}' => {
                        *i += 1;
                        return Ok(());
                    }
                    _ => return Err("expected ',' or '}' in object".to_string()),
                }
            }
        }
        b'[' => {
            *i += 1;
            skip_ws(bytes, i);
            if *i < bytes.len() && bytes[*i] == b']' {
                *i += 1;
                return Ok(());
            }
            loop {
                scan_value(bytes, i, depth + 1)?;
                skip_ws(bytes, i);
                if *i >= bytes.len() {
                    return Err("unterminated array".to_string());
                }
                match bytes[*i] {
                    b',' => *i += 1,
                    b']' => {
                        *i += 1;
                        return Ok(());
                    }
                    _ => return Err("expected ',' or ']' in array".to_string()),
                }
            }
        }
        b't' => expect_literal(bytes, i, b"true"),
        b'f' => expect_literal(bytes, i, b"false"),
        b'n' => expect_literal(bytes, i, b"null"),
        _ => scan_number(bytes, i),
    }
}

fn scan_string(bytes: &[u8], i: &mut usize) -> Result<(), String> {
    if *i >= bytes.len() || bytes[*i] != b'"' {
        return Err("expected a string".to_string());
    }
    *i += 1;
    while *i < bytes.len() {
        match bytes[*i] {
            b'"' => {
                *i += 1;
                return Ok(());
            }
            b'\\' => {
                *i += 1;
                if *i >= bytes.len() {
                    return Err("unterminated escape in string".to_string());
                }
                *i += 1; // any escaped byte is consumed as-is
            }
            _ => *i += 1,
        }
    }
    Err("unterminated string".to_string())
}

fn scan_number(bytes: &[u8], i: &mut usize) -> Result<(), String> {
    let start = *i;
    if *i < bytes.len() && (bytes[*i] == b'-' || bytes[*i] == b'+') {
        *i += 1;
    }
    let mut digits = 0;
    while *i < bytes.len()
        && (bytes[*i].is_ascii_digit()
            || bytes[*i] == b'.'
            || bytes[*i] == b'e'
            || bytes[*i] == b'E'
            || bytes[*i] == b'+'
            || bytes[*i] == b'-')
    {
        if bytes[*i].is_ascii_digit() {
            digits += 1;
        }
        *i += 1;
    }
    if digits == 0 {
        return Err(format!("invalid JSON value at byte {start}"));
    }
    Ok(())
}

fn expect_literal(bytes: &[u8], i: &mut usize, literal: &[u8]) -> Result<(), String> {
    if bytes.len() - *i >= literal.len() && &bytes[*i..*i + literal.len()] == literal {
        *i += literal.len();
        Ok(())
    } else {
        Err("invalid JSON literal".to_string())
    }
}

fn skip_ws(bytes: &[u8], i: &mut usize) {
    while *i < bytes.len() && matches!(bytes[*i], b' ' | b'\t' | b'\n' | b'\r') {
        *i += 1;
    }
}

/// Escape a value for embedding inside a JSON string.
fn json_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ch if (ch as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => out.push(ch),
        }
    }
    out
}

/// A short, human-readable excerpt of a response body for an error message.
fn snippet(body: &str) -> String {
    let mut out: String = body.chars().take(200).collect();
    if body.chars().count() > 200 {
        out.push('…');
    }
    if out.is_empty() {
        out.push_str("(empty body)");
    }
    out
}
