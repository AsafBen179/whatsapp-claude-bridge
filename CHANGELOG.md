# CHANGELOG

```json
{
  "entries": [
    {
      "id": 1,
      "date": "2026-01-13",
      "task": "Fix Claude Code not responding after init command",
      "implementation": "Added --dangerously-skip-permissions flag and proc.stdin.end() call to CmdExecutor.js. The process was blocking because stdin remained open waiting for input. Closing stdin immediately after spawn allows Claude CLI to execute and return output properly."
    },
    {
      "id": 2,
      "date": "2026-01-13",
      "task": "Clean up unused experimental code",
      "implementation": "Removed NamedPipeExecutor.js, run-claude.bat, 16 test-*.js files, and temp files. These were experimental approaches that are no longer needed after the stdin fix."
    },
    {
      "id": 3,
      "date": "2026-01-13",
      "task": "Add conversation integration test",
      "implementation": "Created tests/conversation-test.js that simulates a 10-step user conversation including greetings, file/folder creation, file reading, modifications, and context verification. Added npm test script to package.json. All tests pass with 100% success rate."
    },
    {
      "id": 4,
      "date": "2026-01-13",
      "task": "Create comprehensive README documentation",
      "implementation": "Added README.md covering project overview, key features, architecture, installation, usage instructions, configuration, admin commands, security considerations, and troubleshooting guide."
    },
    {
      "id": 5,
      "date": "2026-01-13",
      "task": "Add .gitignore file",
      "implementation": "Created .gitignore with standard Node.js ignores including node_modules, logs, .env files, database files, IDE configs, OS files, temp files, and test artifacts."
    },
    {
      "id": 6,
      "date": "2026-01-13",
      "task": "Fix AI summarizer echoing prompt in response",
      "implementation": "Refactored OpenRouterClient.js to use system/user message structure instead of single prompt. Added cleanSummaryResponse() to strip echoed prompts, headers, and formatting. Simplified the prompt to prevent model from adding unwanted Project/Command/Result headers."
    }
  ]
}
```
