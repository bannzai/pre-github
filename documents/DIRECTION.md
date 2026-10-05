---
status: building
decision_date:
cycle_days: 14
veto_wait_hours: 12
daily_issue_cap: 3
launched_at:
---

# 方向性: pre-github

## 仮説

AI エージェントに PR・issue を書かせている開発者 (まず bannzai 自身) は、本物の GitHub に送った後で「個人情報が混ざっていた」「見た目が崩れていた」「文面がおかしかった」に気づいている (起票元のコメント「うっかり個人情報が入った時にレビューで気づくようなケース」)。送った後に直しても、その時点までに通知を受けた人には届いてしまうため、送る前に GitHub と同じ見た目で確かめたい。pre-github は GitHub と同じ REST API (の一部) を受け付けるセルフホストのプロキシで、受け取った PR・issue を GitHub 風の HTML で表示し、送る前の確認と、確認後の完全な削除をできるようにする。

起票元 https://github.com/bannzai/IdeaMemo/issues/172 。自分の作業の道具として作り、収益は目的にしない。需要・競合・マネタイズの事前評価 (evaluate-service-idea) は行っていない。

## 判定基準

| 指標 | 計測元 (skill / コマンド) | 継続のしきい値 | 打ち切り条件 | 転換の条件 |
| --- | --- | --- | --- | --- |
| 14 日間に作った preview (PR・issue) の件数 (bannzai 自身のインスタンス) | インスタンスが preview の作成・更新・削除のたびに D1 の `events` テーブルへ 1 行書く。`npx wrangler d1 execute pre-github --remote --json --command "select count(*) as n from events where kind = 'created' and at >= datetime('now', '-14 days')"` | 5 件以上 | 2 回連続で 2 件未満 | 28 日間で preview が 10 件以上あるのに、送る前の修正 (`kind = 'updated'`) と削除 (`kind = 'deleted'`) が合計 0 件なら、見た目の確認をやめて機械検査 (pre-publish-leak-check skill の検査項目) だけに絞る |
| GitHub の star 数 | `gh api repos/bannzai/pre-github --jq .stargazers_count` | 公開の告知から 28 日で 10 以上 | star では打ち切らない (自分が使っていれば継続) | 28 日で 30 以上なら「Deploy to Cloudflare」ボタンと導入手順の整備に進む |

## 必要な機能

- [ ] GitHub 互換の REST API (一部): `POST` / `GET` / `PATCH` / `DELETE` の `/repos/{owner}/{repo}/issues`、`/repos/{owner}/{repo}/pulls`、`/repos/{owner}/{repo}/issues/{number}/comments`。GitHub Enterprise Server と同じ `/api/v3/` の prefix でも受け付け、`gh api --hostname <host>` と curl がそのまま使える。応答の形 (`number`・`html_url`・`title`・`body`・`state`・`created_at` 等) は GitHub に合わせる。PR の作成は GitHub と同じ `title`・`body`・`head`・`base` に加えて、git サーバーが無いため拡張の `diff` (unified diff の文字列) を受け取る
- [ ] 認証: 1 つの bearer token (`wrangler secret put PRE_GITHUB_TOKEN`)。API は `Authorization: Bearer <token>` / `token <token>` ヘッダ、HTML ページは token を入力する 1 画面のログインで発行する Cookie で守る (インスタンスは公開 URL に置かれるため、未認証では何も表示しない)
- [ ] GitHub 風の HTML ページ: `/{owner}/{repo}/issues/{number}` と `/{owner}/{repo}/pull/{number}`。Markdown (GFM の表・タスクリスト・コードブロック) の描画、画像 URL の表示、PR はファイルごとの差分を追加・削除の色分けで表示。GitHub の PR・issue ページに見た目を寄せる
- [ ] 漏えい候補の強調: ページ上で、電話番号・メールアドレス・ホームディレクトリの絶対パス (`/Users/<名前>`・`/home/<名前>`)・API キーらしい文字列を本文と差分の中で強調し、ページ上部に件数を出す
- [ ] 削除: `DELETE` の API とページ上の削除ボタンで、preview を D1 から完全に消す (論理削除にしない)
- [ ] セルフホストの手順と送信の補助: README の手順 (`git clone` → `npm ci` → `wrangler d1 create` → `wrangler secret put` → `wrangler deploy`) で自分の Cloudflare アカウントに置ける。`scripts/preview-pr.sh` が現在のブランチの差分と title・body を pre-github に送って preview の URL を出す (本物の GitHub へ送る時は同じ title・body で `gh pr create` を使う)
- [ ] 利用記録: 判定基準の計測元になる D1 の `events` テーブル (種類と日時だけ。本文は書かない)

MVP に入れないもの: git push の受け付け (`gh pr create` をそのまま proxy に向ける)、複数ユーザー・組織、レビュー・コメントの編集 UI、画像ファイルのアップロード、本物の GitHub への転送 (送るのは `gh` に任せる)、Webhook。

## デザインの方向

(関門 2 で決める。GitHub の PR・issue ページに見た目を寄せる前提)

## 決めたこと

| 日付 | 場面 | 決めたこと | 決めた人 |
| --- | --- | --- | --- |
| 2026-10-05 | 関門 1 の前 | リポジトリ名 pre-github・公開設定 public・構成 Web (Hono + Cloudflare Workers) ( https://github.com/bannzai/IdeaMemo/issues/172 の立ち上げ情報) | bannzai |
| 2026-10-05 | 関門 1 の前 | ビルド・テスト・ブラウザの動作確認は外部マシン (public の間は GitHub Actions、private にしたら Devin) で行い、開発マシンでは行わない (`/create-new-app` の起動時の指示) | bannzai |
| 2026-10-05 | 関門 1 の前 | 需要・競合・マネタイズの事前評価は行わない (自分の作業の道具で、収益を目的にせず、ストア配布も課金も無いため) | agent |
| 2026-10-05 | 関門 1 の前 | 「GH API と互換」は、REST の一部 (issues・pulls・comments) を GitHub と同じパスと応答の形で受け付け、`gh api --hostname` と curl で使える範囲とする。git push を受け付けて `gh pr create` をそのまま向ける形は MVP に入れない (git サーバーの実装が要るため)。関門 1 で確認する | agent |
| 2026-10-05 | 関門 1 の前 | 「Issue・PR が HTML アップロード、保存が可能」は、受け取った PR・issue を D1 に保存し GitHub 風の HTML で表示することと読む。関門 1 で確認する | agent |
| 2026-10-05 | 関門 1 の前 | ストレージは D1 だけ (画像は URL 参照で、アップロードを MVP に入れない)。認証は 1 つの token。計測・テレメトリは持たず、判定基準は自分のインスタンスの D1 と GitHub の star で読む | agent |
| 2026-10-05 | 関門 1 の前 | bannzai が第三者向けに運用するサービスが無い (各自がセルフホストする) ため、利用規約・プライバシーポリシー・紹介サイト・特定商取引法の表記・Search Console は作らず、README の記載で代える (同じ構成の bannzai/agent-timeline に合わせた) | agent |
| 2026-10-05 | 関門 1 の前 | この文書は castle の型 (見出し固定) に合わせて日本語で書く。README・AGENTS.md・PROJECT.md・コードのコメントは、他者がセルフホストする OSS として英語で書く。関門 1 で OSS として扱うかの返答を得てから確定する | agent |
| 2026-10-05 | 関門 1 の前 | main へのマージで bannzai のインスタンスへ自動デプロイしない。デプロイの workflow は `workflow_dispatch` だけにし、関門 3 で公開に進むと決めた後に有効化する | agent |
| 2026-10-05 | 関門 1 | 作る。機能は上の一覧のまま (「GH API と互換」「HTML アップロード」の読み方も agent の案のまま)。OSS として扱い MIT・英語のまま。bannzai がチャットで出した進行の指示「マージとかガンガン進めていって。止まらないで」を agent が関門 1 の返答 (提示した案のとおり進める) と解釈した。記録: https://github.com/bannzai/pre-github/issues/1#issuecomment-5993708539 。解釈が違えば同 issue のコメントで指摘を受け、行を足して直す | agent (bannzai の進行の指示を根拠に) |
| 2026-10-05 | API の実装 (#5) | issue の `labels` は受け付けて捨てる (保存も応答もしない)。GitHub と同じ名前で違う振る舞いの field を返さないため | agent |
| 2026-10-05 | API の実装 (#5) | `/issues` の一覧・単体・PATCH・DELETE は issue だけを扱い、PR は `/pulls` で扱う。comments だけは GitHub と同じく issue と PR の両方に効く | agent |
| 2026-10-05 | API の実装 (#5) | 番号は `{owner}/{repo}` ごとの最大値 + 1 で採番する。削除後に `events` 以外を残さないため、最新の preview を消すと次の preview が同じ番号を使う | agent |

## agent に任せること

- ライブラリの選定 (Markdown と差分の描画)、D1 のスキーマ、API の細部 (ページング・エラーの形)、ログイン画面の作り
- CI の構成、テストの書き方、E2E の範囲
- 漏えい候補の検出パターンの具体的な正規表現
- 紹介サイトを後から作るか (star の転換の条件に達した時に判断する)
