# Production Action setup

Korea Web Agent v0.3 uses two separate secrets:

- `KWA_RELAY_SECRET` for the PC connector relay only.
- `KWA_ACTION_API_KEY` for Custom GPT Action requests only.

Keep both values secret and never reuse one as the other. After adding or rotating either Netlify environment variable, trigger a fresh production deploy before testing the affected route.

Custom GPT imports `openapi/korea-web-agent-action.yaml` and configures HTTP bearer authentication with `KWA_ACTION_API_KEY`. The GPT should remain private for a personal deployment.
