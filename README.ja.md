<p align="center">
  <img src="desktop/build/icon.png" width="120" alt="MyClaw Logo" />
</p>

<h1 align="center">MyClaw</h1>

<p align="center">
  <strong>エンタープライズ対応・セルフホスト型 AI エージェントプラットフォーム</strong><br/>
  <sub>数分で社内にビジネス AI を導入 -- 数ヶ月ではなく。</sub>
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;|&nbsp;
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="#エンタープライズデプロイ">エンタープライズデプロイ</a> &nbsp;|&nbsp;
  <a href="#主要機能">主要機能</a> &nbsp;|&nbsp;
  <a href="#アーキテクチャ">アーキテクチャ</a> &nbsp;|&nbsp;
  <a href="#クイックスタート">クイックスタート</a> &nbsp;|&nbsp;
  <a href="#コントリビューション">コントリビューション</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/deploy-self--hosted-critical?style=flat-square" alt="Self-Hosted" />
  <img src="https://img.shields.io/badge/electron-33-47848f?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/nestjs-11-e0234e?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/nuxt-4-00dc82?style=flat-square&logo=nuxt.js" alt="Nuxt" />
  <img src="https://img.shields.io/badge/typescript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

MyClaw は**エンタープライズグレード・完全セルフホスト型**の AI エージェントプラットフォームです。社内インフラに **Cloud** をデプロイしてスキル・MCP サーバー・ワークフロー・モデルアクセスを一元管理。従業員は **Desktop** アプリをインストールするだけで、社内ナレッジとツールに接続された本番レベルの AI IDE を即座に利用できます -- **データは社外に出ません**。

> **一言で**: 御社専用の Cursor + Dify + MCP Hub を、一午後でデプロイ。

---

## エンタープライズデプロイ

OpenClaw、Dify、LobeChat などのツールとの根本的な違い -- **MyClaw は初日からエンタープライズデプロイのために設計**されています。後付けではありません。

```
┌─────────────────────────────────────────────────────────────┐
│                      社内ネットワーク                         │
│                                                             │
│  ┌───────────────────────────────────────┐                  │
│  │       MyClaw Cloud (管理側)            │                  │
│  │  ┌─────────┐ ┌──────┐ ┌───────────┐  │                  │
│  │  │ スキル  │ │ MCP  │ │ ワークフロー│  │   PostgreSQL     │
│  │  │ ハブ    │ │ 登録 │ │ テンプレート│  │◄──── + FastDFS   │
│  │  └────┬────┘ └──┬───┘ └─────┬─────┘  │                  │
│  │       └─────────┼───────────┘         │                  │
│  └─────────────────┼────────────────────┘                  │
│                    │ REST API                                │
│         ┌──────────┼──────────┐                             │
│         │          │          │                              │
│    ┌────┴────┐ ┌───┴────┐ ┌──┴─────┐                       │
│    │Desktop A│ │Desktop B│ │Desktop C│  ... N人の従業員     │
│    │(開発)   │ │(PM)     │ │(QA)     │                      │
│    └─────────┘ └────────┘ └─────────┘                       │
│         │          │          │                              │
│    ┌────┴──────────┴──────────┴────┐                        │
│    │    社内 LLM ゲートウェイ / API  │ (またはパブリッククラウド) │
│    └───────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

### 運用モデル

| 役割 | コンポーネント | 責務 |
|---|---|---|
| **IT / 管理者** | **Cloud** | 社内サーバーにデプロイ。承認済みスキルを管理、社内 MCP サーバーを登録、ワークフローテンプレートを配布、モデルアクセスと API キーを管理。 |
| **従業員** | **Desktop** | Electron アプリをインストール。エンタープライズ承認済みの AI ツール、スキル、ワークフローに即アクセス。ローカルで会話・実行、承認ゲートで安全性を確保。 |
| **プラットフォームチーム** | **両方** | Cloud Hub でカスタムスキル・ワークフローを構築、全 Desktop にプッシュ。利用状況を監視、利用可能なモデルとツールを制御。 |

### なぜ SaaS AI ツールではダメなのか？

| 懸念事項 | SaaS ツール | MyClaw（セルフホスト） |
|---|---|---|
| **データプライバシー** | コード・文書が第三者サーバーへ | すべて社内ネットワークに留まる |
| **モデル選択** | ベンダーロックイン | 9 プロバイダー + Ollama/LM-Studio プライベートデプロイ |
| **カスタムツール** | プラットフォーム提供分のみ | MCP + スキル + 組み込みツールで無限拡張 |
| **ワークフロー** | 手動または別ツールが必要 | ビジュアルワークフローエンジン内蔵 |
| **コスト** | 人数課金の SaaS | セルフホスト + MIT ライセンス、LLM API 費用のみ |
| **企業統制** | 管理画面は後付け | Cloud = 初日からの企業コントロールプレーン |
| **導入速度** | 数ヶ月の調達プロセス | `docker compose up` + Desktop インストーラー配布 |

---

## 主要機能

### Cloud -- エンタープライズコントロールプレーン

**スキルハブ** -- 組織全体で AI スキルを一元管理・バージョン管理・配布。管理者がスキルパッケージを審査・公開、従業員は Desktop からワンクリックインストール。

**MCP サーバーレジストリ** -- 社内 MCP サーバー（データベースアクセス、内部 API、監視ツール）を登録。登録後、全 Desktop ユーザーに自動同期。

**ワークフローテンプレート** -- Cloud で再利用可能なワークフローテンプレート（コードレビュー、インシデント対応、オンボーディング）を設計し全従業員に配布。チーム間で一貫した AI 駆動プロセスを実現。

**モデルアクセス制御** -- 利用可能な LLM プロバイダーと API キーを設定。承認済みモデルのみに従業員をルーティング。プライベートデプロイ（Ollama、LM-Studio、VLM）に対応。

**認証 & 分析** -- トークンベース認証、インストール追跡、ユーザー/パッケージ単位の利用分析。

### Desktop -- 全従業員のための AI IDE

**エージェンティックチャット** -- マルチターン会話 + 完全なエージェントループ（モデル -> ツール呼び出し -> 実行 -> 結果返却 -> 継続推論）。最大 200 ラウンドの自律実行、承認ゲート設定可能。

**ビジュアルワークフローエンジン** -- 8 種ノード（開始、LLM、ツール、人的入力、条件分岐、サブグラフ、合流、終了）、3 種エッジ（通常、並列、条件付き）、チェックポイントベースの一時停止/再開。

```
 [開始] --> [LLM: 分析] --> [条件: 合格?]
                                |         |
                              true      false
                                |         |
                          [ツール: デプロイ] [人的入力: レビュー]
                                |         |
                                +--> [合流] --> [終了]
```

**13 の組み込みツール** -- ファイル読み書き/編集/検索、Git 操作、コマンド実行、HTTP フェッチ、Web 検索、タスク管理。各ツールにリスクカテゴリ（読み取り/書き込み/実行）と独立した承認ポリシー。

**MCP 統合** -- [Model Context Protocol](https://modelcontextprotocol.io/) を完全サポート。stdio + HTTP/SSE デュアルトランスポート。Claude Desktop と Cursor からワンクリックインポート。Cloud レジストリの企業 MCP サーバーは自動同期。

**スキルシステム** -- HTML ベースのスキルビュー、iframe postMessage 双方向通信。Cloud Hub の企業スキルと個人スキルが共存。

**マルチモデル** -- 9 プロバイダー：OpenAI、Anthropic、QWen、Moonshot、Ollama、LM-Studio、OpenRouter、VLM、汎用 OpenAI 互換。動的モデル検出、モデル別コンテキストバジェット、機能プロービング。

**承認ゲートウェイ** -- 各マシンでの AI の動作をきめ細かく制御：

| モード | 動作 |
|---|---|
| `prompt` | 書き込み/削除の前に常に確認 |
| `auto-read-only` | 読み取りは自動承認、書き込みは確認 |
| `auto-allow-all` | ワークスペース内は自動承認 |
| `unrestricted` | 完全自律（注意して使用） |

**メモリ & コンテキストインテリジェンス** -- 会話からメモリを自動抽出、関連性ベースの検索、80% 容量でのスマート圧縮、モデル生成要約で直近 12 ターンを保持。

---

## アーキテクチャ

```
MyClaw/
├── desktop/                  # Electron + React -- 従業員がインストール
│   ├── src/main/             #   メインプロセス: IPC ハンドラー + 20 サービス
│   ├── src/renderer/         #   React UI: 17 ルート、Zustand ストア
│   ├── src/preload/          #   Electron ブリッジ (contextBridge)
│   └── shared/contracts/     #   15 ドメイン型ファイル
│
├── cloud/                    # NestJS + Nuxt -- IT/管理者がデプロイ
│   ├── apps/cloud-api/       #   NestJS バックエンド (7 モジュール、Prisma ORM)
│   ├── apps/cloud-web/       #   Nuxt 3 BFF ポータル (管理コンソール)
│   ├── packages/shared/      #   クラウドドメイン型
│   └── infra/                #   Docker Compose (PostgreSQL 16)
│
└── docs/plans/               # 設計ドキュメント
```

### デスクトップ内部アーキテクチャ

```
┌─────────────────────────────────────────────────┐
│             レンダラープロセス (React)              │
│  ┌─────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  チャット│ │ ワークフロー│ │  スキル / MCP   │  │
│  │  ページ │ │  キャンバス │ │  管理           │  │
│  └────┬────┘ └────┬─────┘ └────────┬─────────┘  │
│       └───────────┼────────────────┘             │
│                   │ IPC (contextBridge)           │
├───────────────────┼─────────────────────────────┤
│             メインプロセス                         │
│  ┌────────────────┼────────────────────────┐     │
│  │  モデルクライアント │  MCP サーバー管理   │     │
│  │  ツールエグゼキュータ│  メモリサービス     │     │
│  │  コンテキスト   │  トークンバジェット    │     │
│  │  アセンブラ     │  マネージャ           │     │
│  └────────────────┴────────────────────────┘     │
│       │                    │                     │
│  ┌────┴────┐    ┌─────────┴──────────┐           │
│  │  LLM   │    │  MCP サーバー       │           │
│  │ プロバイダ│    │  (stdio / HTTP)    │           │
│  └─────────┘    └────────────────────┘           │
└─────────────────────────────────────────────────┘
```

---

## 技術スタック

| レイヤー | テクノロジー |
|---|---|
| デスクトップランタイム | Electron 33 |
| デスクトップ UI | React 18 + React Router 6 + Zustand 5 |
| クラウドバックエンド | NestJS 11 + Prisma + PostgreSQL 16 |
| クラウドフロントエンド | Nuxt 4 (SSR + BFF) |
| ビルドツール | Vite 6 |
| テスト | Vitest 3 |
| 言語 | TypeScript 5.8 (strict) |
| パッケージマネージャ | pnpm 9 |
| デスクトップパッケージング | electron-builder |
| アイコン | Lucide React |

---

## クイックスタート

### 前提条件

- **Node.js** >= 18
- **pnpm** >= 9
- **Docker**（Cloud データベース用）

### Cloud のデプロイ（管理者）

```bash
git clone https://github.com/407073118/MyClaw.git
cd MyClaw/cloud

pnpm install

# PostgreSQL を起動
pnpm dev:db

# データベースを初期化（スキーマ + シードデータ）
pnpm setup:api

# API サーバーを起動（ポート 43210）
pnpm dev:api

# Web 管理ポータルを起動（ポート 43211）
pnpm dev:web
```

> 本番環境: `pnpm build` + PM2 + Nginx リバースプロキシを使用。

### Desktop のインストール（従業員）

```bash
cd MyClaw/desktop

pnpm install

# 開発モード
pnpm dev

# ビルド & インストーラーとしてパッケージ化（.exe / .dmg / .AppImage）
pnpm dist
```

> インストーラーを従業員に配布。初回起動時に Cloud サーバーの URL を指定。

---

## コアコンセプト

### スキル

AI 機能を拡張する自己完結型パッケージ。エンタープライズ管理者が Cloud Hub に公開、従業員が Desktop でインストール。

```
my-skill/
├── SKILL.md          # スキル説明（システムプロンプトに注入）
├── view.html         # インタラクティブ UI（WebPanel でレンダリング）
├── data/             # バンドルデータセット
├── scripts/          # 自動化スクリプト
├── references/       # リファレンスドキュメント
└── agents/           # サブエージェント定義
```

### MCP サーバー

[Model Context Protocol](https://modelcontextprotocol.io/) をネイティブサポート -- AI を外部ツールに接続する標準プロトコル：

- **stdio** -- ローカル MCP サーバーを子プロセスとして起動
- **HTTP/SSE** -- リモート / エンタープライズ MCP サーバーに接続
- **自動インポート** -- Claude Desktop と Cursor の設定を自動検出
- **エンタープライズレジストリ** -- Cloud 管理の MCP サーバーが全 Desktop に自動同期

### ワークフローノード

| ノード | 用途 |
|---|---|
| **開始** | エントリポイント |
| **LLM** | プロンプトでモデル推論 |
| **ツール** | 組み込み / MCP / スキルツールを実行 |
| **人的入力** | 人的レビューのために一時停止 |
| **条件分岐** | 状態に基づく分岐 |
| **サブグラフ** | ネストされたワークフロー実行 |
| **合流** | 並列パスをマージ（全部/いずれか） |
| **終了** | 終端ノード |

---

## ロードマップ

- [x] **v1.0** -- コアエージェントループ、チャット UI、ツール実行、スキルシステム
- [x] **v1.1** -- ツール並行実行、API リトライ、スマート圧縮、MCP インポート、トークン可視化
- [ ] **v2.0** -- サブエージェントオーケストレーション、Cloud Hub 同期、エンタープライズ RBAC
- [ ] **v2.1** -- ワークフローランタイムエンジン、永続的クロスセッションメモリ
- [ ] **v3.0** -- マルチエージェント協調、監査ログ、SSO/LDAP、プラグインマーケットプレイス

---

## コントリビューション

バグレポート、機能リクエスト、Pull Request など歓迎します！

1. リポジトリをフォーク
2. フィーチャーブランチを作成（`git checkout -b feature/amazing-feature`）
3. 変更をコミット（`git commit -m 'Add amazing feature'`）
4. ブランチにプッシュ（`git push origin feature/amazing-feature`）
5. Pull Request を作成

## ライセンス

MIT ライセンス -- 詳細は [LICENSE](LICENSE) をご覧ください。

---

<p align="center">
  <strong>カスタマイズできない AI ツールに人数課金を払うのはもうやめましょう。</strong><br/>
  MyClaw をデプロイ。AI スタックを自分たちの手に。<br/><br/>
  <sub>このプロジェクトが役に立ったら、スターをお願いします！</sub>
</p>
