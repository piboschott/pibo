# Gateway Examples

These are the two minimal transport paths we currently keep supported.

## Console Client To Gateway

Terminal 1:

```bash
npm run gateway
```

Terminal 2:

```bash
npm run client -- receiver
```

Type a normal message in the client. The gateway routes it into the `receiver` session queue and streams the assistant answer back to the client.

Useful client commands:

```text
/status
/clear
/abort
/quit
```

## TUI Agent Tool To Gateway

Terminal 1:

```bash
npm run gateway
```

Terminal 2:

```bash
npm run client -- receiver
```

Terminal 3:

```bash
npm run tui:gateway
```

Prompt the TUI agent:

```text
Nutze pibo_gateway_send und sende an sessionKey receiver: Diese Nachricht kam vom TUI-Agenten ueber das Gateway.
```

Expected behavior:

- The receiver client prints the incoming external message.
- The receiver session answers through the gateway.
- The TUI tool call returns the receiver assistant reply.
