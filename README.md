# unlibra VPM Repository

unlibraのUnityツールをVRChat Creator Companion（VCC）から導入・更新するための共通一覧です。

配信先: https://docs.unlibra.com/vpm/

配信開始後、ページの「VCCに追加」から登録し、使用するプロジェクトのManage Packagesでパッケージを追加してください。初回VPM版の公開と一覧への登録までは配布準備中です。

## 自動更新の初期設定

1. mainを既定ブランチにし、GitHub PagesをGitHub Actions方式で設定します。ENABLE_PAGESをtrueにして、Sync VPM releasesを入力欄を空のまま手動実行し、初期一覧を配信します。
2. unlibra/vpmだけを対象に、Actions read/write権限を持つfine-grained personal access tokenを用意します。Contents write権限は不要です。
3. 製品リポジトリのActions SecretへVPM_DISPATCH_TOKENという名前で登録します。トークンをGitや文書へ保存しません。期限を設けた場合は期限前に更新します。

製品のRelease CIが公開後にsync.ymlを起動します。mainへの通常のpushでも同じ公開処理を実行します。このワークフローはmainでのみ実行し、公開済みの安定版ZIP・package.jsonを検証して未登録の版をコミットし、同じ実行内でPagesへ配信します。製品側は対象の実行IDを追跡し、公開一覧にその版が現れるまで待ちます。通知だけが失敗した場合は、製品のnotify-vpmジョブを再実行してください。

複数通知が重なったときの取りこぼしを避けるため、通知と通常のmain更新のどちらでも、実行時には登録済み全製品の未登録VPM版を確認します。unitypackageだけの旧版、Draft、Prereleaseは取り込みません。既に記録した版は変更・削除しません。

## 手動での確認・復旧

Node.js 24以降を使います。追加のnpmパッケージは不要です。

製品のGitHub Releasesへ公開済みの安定版ZIPとpackage.jsonが揃ってから実行します。

```sh
node tools/import-release.mjs com.unlibra.mururu-blink-lipsync v1.2.0
node tools/history.mjs <変更前のコミットSHA>
node --test tools/listing.test.mjs tools/sync.test.mjs
node tools/listing.mjs
```

ZIP内のpackage.jsonとライセンスの同梱を検証し、版ごとのJSONとZIPのSHA-256を記録します。新しい版のJSONと生成結果をレビューしてコミットします。CIでは変更前のコミットにある版の変更・削除と公開済み製品の登録解除を拒否します。既存の版を削除・上書きしません。初期設定後は製品のRelease CIから自動更新します。

source.jsonは登録する製品、packages/は公開済みの版の記録、site/は生成結果です。ZIP本体と製品コードは各製品リポジトリで管理します。

## 配信

listing.ymlは各ブランチ・PRのテストと生成だけを行います。Pages配信はmainでのみ、リポジトリ変数ENABLE_PAGESがtrueの場合に実行します。GitHub PagesをGitHub Actions方式に設定してから有効化してください。mainに移す前に対象差分全体のcode-reviewを行います。自動取り込みはデータの追加だけをコミットします。GITHUB_TOKENによるpushは別ワークフローを起動しないため、取り込み・検証・配信をsync.ymlの同じ実行内で完了させます。
