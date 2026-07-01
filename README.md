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

Anton is designed to run with local coding models such as:

```text
qwen2.5-coder:7b
```

Model requests use a conservative local-agent default:

```text
num_ctx: 32768
temperature: 0.15
```

## Agent Workflow

For project edit requests, Anton now follows a structured coding-agent loop:

1. Understand the request and constraints.
2. Inspect the workspace structure.
3. Search for the files that own the requested behavior.
4. Read the smallest useful file context.
5. Apply focused file edits.
6. Run the best available local verification command from `package.json`.
7. Report changed files and verification output.

If the project has scripts such as `test`, `check`, `typecheck`, `lint`, or `build`, Anton runs the first suitable command automatically after an edit.
