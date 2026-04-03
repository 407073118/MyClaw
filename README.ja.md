<p align="center">
  <img src="desktop/build/icon.png" width="120" alt="MyClaw Logo" />
</p>

<h1 align="center">MyClaw</h1>

<p align="center">
  <strong>オープンソース AI エージェントプラットフォーム -- ビジュアルワークフローエンジン搭載</strong>
</p>

<p align="center">
  <a href="README.md">English</a> &nbsp;|&nbsp;
  <a href="README.zh-CN.md">简体中文</a> &nbsp;|&nbsp;
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="#クイックスタート">クイックスタート</a> &nbsp;|&nbsp;
  <a href="#主要機能">主要機能</a> &nbsp;|&nbsp;
  <a href="#アーキテクチャ">アーキテクチャ</a> &nbsp;|&nbsp;
  <a href="#技術スタック">技術スタック</a> &nbsp;|&nbsp;
  <a href="#コントリビューション">コントリビューション</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version" />
  <img src="https://img.shields.io/badge/electron-33-47848f?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-18-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/nestjs-11-e0234e?style=flat-square&logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/nuxt-4-00dc82?style=flat-square&logo=nuxt.js" alt="Nuxt" />
  <img src="https://img.shields.io/badge/typescript-5.8-3178c6?style=flat-square&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

---

MyClaw は、**デスクトップ IDE**、**クラウドマーケットプレイス**、**ビジュアルワークフローエンジン**を統合したオープンソースのローカルファースト AI エージェントプラットフォームです。あなた専用の AI オペレーティングシステムとして、任意の LLM に接続し、複雑なワークフローを視覚的にオーケストレーションし、スキルと MCP サーバーであらゆる機能を拡張できます。

> **一言で**: Cursor/Windsurf 風 AI IDE + n8n/Dify 風ビジュアルワークフロー + MCP エコシステム、オールインワン。

---

## なぜ MyClaw？

| 課題 | MyClaw のソリューション |
|---|---|
| 単一 AI プロバイダーへのロックイン | **9 種類のプロバイダー** -- OpenAI、Anthropic、QWen、Moonshot、Ollama、LM-Studio、OpenRouter など |
| AI のマシン操作を制御できない | **きめ細かな承認ゲートウェイ** -- 読み取り/書き込み/実行の 3 段階リスク分類、4 つの承認モード |
| ワークフロー構築にコーディングが必要 | **ビジュアル DAG キャンバス** -- ドラッグ、接続、分岐、合流 -- コード不要 |
| コンテキストウィンドウの制限 | **スマート圧縮** -- 容量 80% で自動要約、直近 12 ターンを保持 |
| ツールが各所に分散 | **MCP + スキル + 13 の組み込みツール** -- 統一ツールレイヤー |

---

## 主要機能

### デスクトップアプリ (Electron)

**エージェンティックチャット** -- ストリーミングレスポンスによるマルチターン会話と、エージェントツールループ（モデル -> ツール呼び出し -> 実行 -> 結果返却 -> 継続推論）。承認ゲートを設定可能な最大 200 ラウンドの自律実行をサポート。

**ビジュアルワークフローエンジン** -- 8 種類のノード（開始、LLM、ツール、人的入力、条件分岐、サブグラフ、合流、終了）、3 種類のエッジ（通常、並列、条件付き）、チェックポイントベースの実行と一時停止/再開。

```
 [開始] --> [LLM: 分析] --> [条件: 合格?]
                                |         |
                              true      false
                                |         |
                          [ツール: デプロイ] [人的入力: レビュー]
                                |         |
                                +--> [合流] --> [終了]
```

**13 の組み込みツール** -- ファイル読み書き/編集/検索、Git 操作、コマンド実行、HTTP フェッチ、Web 検索、タスク管理。各ツールにリスクカテゴリ（読み取り/書き込み/実行）と独立した承認ポリシーを設定可能。

**MCP 統合** -- [Model Context Protocol](https://modelcontextprotocol.io/) を完全サポート。stdio と HTTP/SSE デュアルトランスポート。Claude Desktop と Cursor の設定をワンクリックインポート。リアルタイムヘルスモニタリング。

**スキルシステム** -- HTML ベースのスキルビューと、iframe postMessage による双方向通信。スキルは関数ツールとしてモデルに公開され、埋め込み WebPanel でレンダリング。

**マルチモデルサポート** -- プロバイダー API からモデルを動的に検出。モデルごとに 8 項目のコンテキストバジェットを設定可能。プロバイダー固有の機能プロービング（ビジョン、ツール、推論）。

**メモリ & コンテキストインテリジェンス** -- 会話からのメモリ自動抽出、関連性ベースのランキングと検索、モデル生成要約によるスマートコンテキスト圧縮。

### クラウドプラットフォーム (NestJS + Nuxt)

**マーケットプレイスハブ** -- スキル、ワークフロー、MCP 設定、エージェントテンプレートの閲覧・公開・インストール。バージョン管理対応。

**スキルパブリッシング** -- スキルパッケージのアップロード、自動バージョニング、カテゴリタグ付け、アーティファクトストレージ。

**MCP レジストリ** -- MCP サーバーカタログの一元管理、ヘルストラッキング、ツール列挙。

**認証 & マルチテナンシー** -- トークンベース認証（アクセス/リフレッシュ）、ユーザーごとのインストール追跡と分析。

---

## アーキテクチャ

```
MyClaw/
├── desktop/                  # Electron + React デスクトップアプリ
│   ├── src/main/             #   メインプロセス: IPC ハンドラー + 20 サービス
│   ├── src/renderer/         #   React UI: 17 ルート、Zustand ストア
│   ├── src/preload/          #   Electron ブリッジ (contextBridge)
│   └── shared/contracts/     #   15 ドメイン型ファイル
│
├── cloud/                    # クラウドプラットフォーム
│   ├── apps/cloud-api/       #   NestJS バックエンド (7 モジュール、Prisma ORM)
│   ├── apps/cloud-web/       #   Nuxt 3 BFF ポータル
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
- **Docker**（クラウドプラットフォームのデータベース用）

### デスクトップアプリ

```bash
# リポジトリをクローン
git clone https://github.com/407073118/MyClaw.git
cd MyClaw/desktop

# 依存関係をインストール
pnpm install

# 開発モード
pnpm dev

# ビルド & 実行
pnpm build
pnpm start

# インストーラーとしてパッケージ化
pnpm dist
```

### クラウドプラットフォーム

```bash
cd MyClaw/cloud

# 依存関係をインストール
pnpm install

# PostgreSQL を起動
pnpm dev:db

# データベースを初期化
pnpm setup:api

# API サーバーを起動（ポート 43210）
pnpm dev:api

# Web ポータルを起動（ポート 43211）
pnpm dev:web
```

---

## コアコンセプト

### スキル

スキルは MyClaw の機能を拡張する自己完結型パッケージです：

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

MyClaw は [Model Context Protocol](https://modelcontextprotocol.io/) をネイティブサポート：

- **stdio トランスポート** -- ローカル MCP サーバーを子プロセスとして起動
- **HTTP/SSE トランスポート** -- リモート MCP サーバーに接続
- **自動インポート** -- Claude Desktop と Cursor の設定を自動検出

### ワークフローノード

| ノード | 用途 |
|---|---|
| **開始** | ワークフローのエントリポイント |
| **LLM** | モデルにプロンプトを送信しレスポンスをキャプチャ |
| **ツール** | 登録済みツールを実行（組み込み、MCP、スキル） |
| **人的入力** | 実行を一時停止しユーザー入力を待機 |
| **条件分岐** | 状態評価に基づく分岐（等しい、等しくない、存在する） |
| **サブグラフ** | 別のワークフローをネスト実行として呼び出し |
| **合流** | 並列実行パスをマージ（全部/いずれかモード） |
| **終了** | 終端ノード |

### 承認モード

| モード | 動作 |
|---|---|
| `prompt` | 書き込み/削除操作の実行前に常に確認 |
| `auto-read-only` | 読み取り専用ツールを自動承認、書き込みは確認 |
| `auto-allow-all` | ワークスペースパス内のツールを自動承認 |
| `unrestricted` | 確認なし（注意して使用） |

---

## ロードマップ

- [x] **v1.0** -- コアエージェントループ、チャット UI、ツール実行、スキルシステム
- [x] **v1.1** -- ツール並行実行、API リトライ、スマート圧縮、MCP インポート、トークン可視化
- [ ] **v2.0** -- サブエージェントオーケストレーション、クラウドハブ閲覧・インストール
- [ ] **v2.1** -- ワークフロー実行エンジン（ランタイム）、永続的クロスセッションメモリ
- [ ] **v3.0** -- マルチエージェント協調、エンタープライズ機能、プラグインマーケットプレイス

---

## コントリビューション

バグレポート、機能リクエスト、Pull Request など、あらゆる形での貢献を歓迎します！

1. リポジトリをフォーク
2. フィーチャーブランチを作成（`git checkout -b feature/amazing-feature`）
3. 変更をコミット（`git commit -m 'Add amazing feature'`）
4. ブランチにプッシュ（`git push origin feature/amazing-feature`）
5. Pull Request を作成

---

## ライセンス

本プロジェクトは MIT ライセンスの下で公開されています -- 詳細は [LICENSE](LICENSE) ファイルをご覧ください。

---

<p align="center">
  MyClaw チームが情熱を込めて開発<br/>
  <sub>このプロジェクトが役に立ったら、スターをお願いします！</sub>
</p>
