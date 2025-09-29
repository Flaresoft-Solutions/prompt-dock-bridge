# Examples

This directory contains example implementations for integrating with Prompt Dock Bridge.

## client.js

A complete Node.js client implementation demonstrating:
- RSA-2048 key generation and cryptographic signing
- Pairing flow with bridge
- WebSocket connection with proper origin validation
- Plan generation and approval workflow
- Real-time execution monitoring

### Usage

```bash
# Interactive pairing and execution
node examples/client.js --prompt "Add error handling to the login function"

# Specify working directory and agent
node examples/client.js \
  --workdir /path/to/project \
  --agent cursor-agent \
  --prompt "Refactor the authentication module"

# Custom bridge endpoint
node examples/client.js \
  --bridge-url http://localhost:52720 \
  --ws-url ws://localhost:52721 \
  --prompt "Fix the memory leak in the server"
```

### Options

- `--prompt, -p`: Prompt to execute
- `--workdir, -w`: Working directory (default: current directory)
- `--agent, -a`: Agent type (default: claude-code)
- `--bridge-url`: HTTP bridge URL (default: http://localhost:51720)
- `--ws-url`: WebSocket URL (default: ws://localhost:51721)
- `--origin`: Origin header (default: http://localhost:3000)

### Requirements

```bash
npm install ws commander canonicalize
```

### Security Notes

- Uses proper RSA-2048 cryptographic signing
- Validates origin headers
- Implements message timeout and error handling
- Follows bridge security protocols exactly