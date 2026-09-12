# FUTURE Icebox

## Plugins
response = requests.post(
  url="https://openrouter.ai/api/v1/chat/completions",
  headers={
    "Authorization": "Bearer <OPENROUTER_API_KEY>",
    "HTTP-Referer": "<YOUR_SITE_URL>", # Optional. Site URL for rankings on openrouter.ai.
    "X-OpenRouter-Title": "<YOUR_SITE_NAME>", # Optional. Site title for rankings on openrouter.ai.
  },
  data=json.dumps({
    "model": "~openai/gpt-sol-latest",
    "messages": [
      {
        "role": "user",
        "content": "What is the meaning of life?"
      }
    ]
  })
)
models:
https://openrouter.ai/models
https://openrouter.ai/docs/quickstart#using-the-openrouter-api

Considerations
https://github.com/PawanOsman/OpenCursor
https://github.com/anomalyco/opencode

Pipeline tools like:
https://github.com/DietrichGebert/ponytail/
RTK
AgentMemory


