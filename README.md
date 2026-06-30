# Anton

Anton is a local desktop coding IDE for macOS that uses Ollama models running on this computer.

## Run From Source

```bash
npm install
npm start
```

## Build The App Bundle

```bash
npm run package
```

The packaged app is created at:

```text
dist/mac/Anton.app
```

## Local AI

Anton connects to Ollama at:

```text
http://localhost:11434
```

Install or switch models in Ollama, then use the model dropdown in Anton.
