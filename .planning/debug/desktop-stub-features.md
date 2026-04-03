---
status: investigating
trigger: "desktop has many stub/fake features - chat doesn't work, model test is fake, need comprehensive audit and fix"
created: 2026-03-31T00:00:00Z
updated: 2026-03-31T00:00:00Z
---

## Current Focus

hypothesis: Most features in desktop are stubs returning fake data without real backend calls
test: Read all IPC handlers and renderer pages to identify stubs vs real implementations
expecting: Find sendMessage not calling any AI API, model test returning hardcoded results
next_action: Read all key source files

## Symptoms

expected: Chat should send messages to AI model and get responses. Model test should actually test connectivity. All features should be functional.
actual: Chat doesn't work (messages don't send). Model test returns "可用 (0ms)" instantly (likely fake). Many features are stubs.
errors: None visible - things just don't work
reproduction: npm start, login, try to chat or use any feature
started: New app, features were never real - all stubs

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
