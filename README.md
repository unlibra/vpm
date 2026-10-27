# unlibra VPM Repository

unlibraのUnityツールをVRChat Creator Companion（VCC）から導入・更新するための共通一覧です。

配信先: https://docs.unlibra.com/vpm/

配信開始後、ページの「VCCに追加」から登録し、使用するプロジェクトのManage Packagesでパッケージを追加してください。初回VPM版の公開と一覧への登録までは配布準備中です。

## 一覧の更新

Node.js 24以降を使います。追加のnpmパッケージは不要です。

製品のGitHub Releasesへ公開済みの安定版ZIPとpackage.jsonが揃ってから実行します。

```sh
node tools/import-release.mjs com.unlibra.mururu-blink-lipsync v1.2.0
node --test tools/listing.test.mjs
node tools/listing.mjs
```

新しい版のJSON、ZIPのSHA-256、生成結果をレビューしてコミットします。既存の版を削除・上書きしません。製品Releaseの公開だけでは一覧は更新されません。

source.jsonは登録する製品、packages/は公開済みの版の記録、site/は生成結果です。ZIP本体と製品コードは各製品リポジトリで管理します。

## 配信

featureブランチ・PRではテストと生成を行います。Pages配信はmainでのみ、リポジトリ変数ENABLE_PAGESがtrueの場合に実行します。GitHub PagesをGitHub Actions方式に設定してから有効化してください。mainに移す前に対象差分全体のcode-reviewを行います。
