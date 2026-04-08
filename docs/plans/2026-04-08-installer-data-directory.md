# Installer Data Directory Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Windows installer users to choose a writable MyClaw data directory separate from the installation directory, and have the packaged app read that choice on startup.

**Architecture:** Use an NSIS custom page inserted after the installation directory page to collect a data-directory path. Persist that choice as a small sidecar file in the installation directory, then have the Electron main-process directory service read that sidecar before deciding where `userData` and `myClaw` business data live.

**Tech Stack:** Electron, electron-builder NSIS include script, TypeScript, Vitest.

---
