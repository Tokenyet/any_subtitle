(() => {
  const translations = {
    home: {
      en: {
        pageTitle: "Any Subtitle — Local live and accurate captions",
        pageDescription: "Generate live or accurate captions for the current browser tab with a local NVIDIA GPU.",
        lead: "Give videos without captions a local subtitle track.",
        liveTitle: "Live captions",
        liveBody: "Capture audio from the tab you select and update captions continuously with the local GPU.",
        accurateTitle: "Accurate captions",
        accurateBody: "Use accessible audio and a larger Whisper model, then synchronize the result to the player timeline.",
        localTitle: "Data stays local",
        localBody: "No cloud speech recognition, ads, analytics, or telemetry. Accurate tracks are cached for seven days.",
        coreTitle: "Windows Local Core required",
        coreBody: "The extension captures and displays captions. The free Any Subtitle Local Core runs FFmpeg, yt-dlp, and CUDA Whisper. Windows 10/11, an NVIDIA GTX/RTX GPU, and about 5 GB are required.",
        downloadCore: "Download Local Core",
        privacy: "Privacy policy",
        support: "Support",
        footer: "Any Subtitle is not affiliated with YouTube, Twitch, or Google."
      },
      "zh-TW": {
        pageTitle: "Any Subtitle — 本機即時與精準字幕",
        pageDescription: "使用本機 NVIDIA GPU，為目前瀏覽器分頁產生即時或精準字幕。",
        lead: "讓沒有字幕的影片，在你的電腦上產生字幕。",
        liveTitle: "即時字幕",
        liveBody: "擷取你主動選取的分頁音訊，使用本機 GPU 持續更新字幕。",
        accurateTitle: "精準字幕",
        accurateBody: "取得可用音訊並以較大的 Whisper 模型處理，完成後跟隨播放器時間軸。",
        localTitle: "資料留在本機",
        localBody: "沒有雲端語音辨識、廣告、分析或遙測。精準字幕快取七天。",
        coreTitle: "需要 Windows 本機核心",
        coreBody: "擴充功能負責擷取與顯示；免費的 Any Subtitle Local Core 負責 FFmpeg、yt-dlp 與 CUDA Whisper。需要 Windows 10/11、NVIDIA GTX/RTX GPU，以及約 5 GB 空間。",
        downloadCore: "下載本機核心",
        privacy: "隱私權政策",
        support: "支援",
        footer: "Any Subtitle 與 YouTube、Twitch 或 Google 無關。"
      },
      ja: {
        pageTitle: "Any Subtitle — ローカルのライブ字幕と高精度字幕",
        pageDescription: "ローカルの NVIDIA GPU で、現在のブラウザータブにライブ字幕または高精度字幕を生成します。",
        lead: "字幕のない動画に、このパソコンで字幕を生成します。",
        liveTitle: "ライブ字幕",
        liveBody: "選択したタブの音声を取得し、ローカル GPU で字幕を継続的に更新します。",
        accurateTitle: "高精度字幕",
        accurateBody: "利用できる音声を大きな Whisper モデルで処理し、プレーヤーのタイムラインに同期します。",
        localTitle: "データはローカルに保存",
        localBody: "クラウド音声認識、広告、分析、テレメトリはありません。高精度字幕は 7 日間キャッシュされます。",
        coreTitle: "Windows Local Core が必要です",
        coreBody: "拡張機能が字幕を取得・表示し、無料の Any Subtitle Local Core が FFmpeg、yt-dlp、CUDA Whisper を実行します。Windows 10/11、NVIDIA GTX/RTX GPU、約 5 GB が必要です。",
        downloadCore: "Local Core をダウンロード",
        privacy: "プライバシーポリシー",
        support: "サポート",
        footer: "Any Subtitle は YouTube、Twitch、Google とは提携していません。"
      }
    },
    support: {
      en: {
        pageTitle: "Support — Any Subtitle", heading: "Any Subtitle Support", lead: "Start by checking the Local Core status.",
        missingTitle: "Shows Not installed", missingBody: "Download and run Any Subtitle Local Core again, then return to the setup page and choose Check again.",
        modelTitle: "Models are incomplete", modelBody: "Run the installer again to resume incomplete downloads. You do not need to reinstall the extension.",
        captionsTitle: "No captions", captionsBody: "Confirm the video is playing and the tab has audio, then stop the current task and start again.",
        scopeTitle: "Supported environment", scopeBody: "Windows 10/11, Chrome, Edge, or Vivaldi 116+, and NVIDIA GTX/RTX. DRM, browser internal pages, Picture-in-Picture, and canvas-only players are not guaranteed.",
        back: "Back to Any Subtitle", privacy: "Privacy policy"
      },
      "zh-TW": {
        pageTitle: "支援 — Any Subtitle", heading: "Any Subtitle 支援", lead: "先從本機核心狀態開始檢查。",
        missingTitle: "顯示「未安裝」", missingBody: "重新下載並執行 Any Subtitle Local Core，完成後回到首次設定頁按「重新檢查」。",
        modelTitle: "模型尚未完成", modelBody: "再次執行安裝器會續傳未完成的下載，不需要重新安裝 Chrome 擴充功能。",
        captionsTitle: "沒有字幕", captionsBody: "確認影片正在播放且分頁有聲音，再停止目前工作並重新開始。",
        scopeTitle: "支援範圍", scopeBody: "支援 Windows 10/11、Chrome／Edge／Vivaldi 116+ 與 NVIDIA GTX／RTX。DRM、瀏覽器內部頁面、Picture-in-Picture、純 canvas 播放器不保證支援。",
        back: "返回 Any Subtitle", privacy: "隱私權政策"
      },
      ja: {
        pageTitle: "サポート — Any Subtitle", heading: "Any Subtitle サポート", lead: "まず Local Core の状態を確認してください。",
        missingTitle: "「未インストール」と表示される", missingBody: "Any Subtitle Local Core を再度ダウンロードして実行し、セットアップページで「再確認」を選んでください。",
        modelTitle: "モデルが未完了", modelBody: "インストーラーをもう一度実行すると未完了のダウンロードを再開します。拡張機能の再インストールは不要です。",
        captionsTitle: "字幕が表示されない", captionsBody: "動画が再生中でタブ音声があることを確認し、現在の処理を停止してもう一度開始してください。",
        scopeTitle: "対応環境", scopeBody: "Windows 10/11、Chrome・Edge・Vivaldi 116 以降、NVIDIA GTX/RTX に対応します。DRM、ブラウザー内部ページ、Picture-in-Picture、Canvas のみのプレーヤーは保証対象外です。",
        back: "Any Subtitle に戻る", privacy: "プライバシーポリシー"
      }
    },
    privacy: {
      en: {
        pageTitle: "Privacy Policy — Any Subtitle", heading: "Privacy Policy", updated: "Last updated: July 17, 2026",
        principleTitle: "Core principle", principleBody: "Transcription runs on the user's Windows computer. Any Subtitle has no cloud speech recognition, ads, analytics, or telemetry, and does not send audio, captions, browsing activity, or cookies to the developer.",
        dataTitle: "Data processed", dataBody: "Only after the user starts captions, the extension processes selected-tab audio, URL, title, accessible media timing, and caption tracks. Cookies are read only after the user grants optional current-site permission for protected content.",
        retentionTitle: "Retention", retentionBody: "Live audio is not retained. Accurate captions and page metadata are kept for up to seven days. Full-playback recordings and cookie files are temporary and deleted after completion, cancellation, or cleanup. Language preferences use browser sync storage.",
        networkTitle: "Network activity", networkBody: "Accurate mode may let the Local Core request audio directly from the site and media hosts selected by the user. Installation and repair download tools and models from GitHub, Hugging Face, and gyan.dev. Data is not sent to developer servers.",
        removeTitle: "Remove local data", removeBody: "Uninstall Any Subtitle Local Core from Windows Installed Apps to remove Native Messaging registration, tools, models, caption caches, and temporary files. Removing only the extension does not remove the Local Core.",
        back: "Back to Any Subtitle", support: "Support"
      },
      "zh-TW": {
        pageTitle: "隱私權政策 — Any Subtitle", heading: "隱私權政策", updated: "最後更新：2026 年 7 月 17 日",
        principleTitle: "核心原則", principleBody: "字幕辨識在使用者的 Windows 電腦上執行。Any Subtitle 不提供雲端語音辨識、廣告、分析或遙測，也不會把音訊、字幕、瀏覽活動或 cookies 傳給開發者。",
        dataTitle: "處理的資料", dataBody: "只有使用者主動開始字幕時，擴充功能才會處理所選分頁的音訊、網址、標題、可存取的媒體時間與字幕軌。受保護內容只有在使用者另外授權目前網站的 optional cookies 權限後才會讀取 cookies。",
        retentionTitle: "保存時間", retentionBody: "即時音訊不保存。精準字幕與頁面 metadata 最多保留七天。完整播放錄音與 cookies 檔案只會暫存在本機，工作完成、取消或清理後刪除。語言偏好保存在瀏覽器同步設定。",
        networkTitle: "網路活動", networkBody: "精準模式可能由本機核心直接向使用者要求轉錄的網站及媒體主機取得音訊。安裝與修復期間會從 GitHub、Hugging Face 與 gyan.dev 下載工具及模型。資料不會送到開發者的伺服器。",
        removeTitle: "移除資料", removeBody: "從 Windows「已安裝的應用程式」移除 Any Subtitle Local Core，即可移除 Native Messaging 設定、工具、模型、字幕快取與暫存檔。只移除瀏覽器擴充功能不會自動移除本機核心。",
        back: "返回 Any Subtitle", support: "支援"
      },
      ja: {
        pageTitle: "プライバシーポリシー — Any Subtitle", heading: "プライバシーポリシー", updated: "最終更新：2026 年 7 月 17 日",
        principleTitle: "基本方針", principleBody: "文字起こしはユーザーの Windows パソコン上で実行されます。Any Subtitle はクラウド音声認識、広告、分析、テレメトリを使用せず、音声、字幕、閲覧活動、Cookie を開発者へ送信しません。",
        dataTitle: "処理するデータ", dataBody: "ユーザーが字幕を開始した場合のみ、選択したタブの音声、URL、タイトル、アクセス可能なメディア時間、字幕トラックを処理します。保護されたコンテンツの Cookie は、現在のサイトへの任意権限をユーザーが許可した場合のみ読み取ります。",
        retentionTitle: "保存期間", retentionBody: "ライブ音声は保存しません。高精度字幕とページ情報は最大 7 日間保存します。全編再生録音と Cookie ファイルは一時的で、完了、キャンセル、クリーンアップ後に削除します。言語設定はブラウザーの同期ストレージに保存します。",
        networkTitle: "ネットワーク通信", networkBody: "高精度モードでは、Local Core がユーザー指定のサイトやメディアホストから音声を直接取得する場合があります。インストールと修復では GitHub、Hugging Face、gyan.dev からツールとモデルを取得します。データは開発者サーバーへ送信しません。",
        removeTitle: "ローカルデータの削除", removeBody: "Windows の「インストールされているアプリ」から Any Subtitle Local Core を削除すると、Native Messaging 登録、ツール、モデル、字幕キャッシュ、一時ファイルが削除されます。拡張機能だけを削除しても Local Core は削除されません。",
        back: "Any Subtitle に戻る", support: "サポート"
      }
    }
  };

  const page = document.body.dataset.page;
  const requested = new URLSearchParams(location.search).get("lang");
  const browserLocale = (requested || navigator.language || "en").replaceAll("_", "-");
  const locale = browserLocale.toLowerCase().startsWith("zh") ? "zh-TW"
    : browserLocale.toLowerCase().startsWith("ja") ? "ja"
      : "en";
  const messages = translations[page]?.[locale] || translations[page]?.en || {};
  document.documentElement.lang = locale;
  document.title = messages.pageTitle || document.title;
  const description = document.querySelector('meta[name="description"]');
  if (description && messages.pageDescription) description.content = messages.pageDescription;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = messages[element.dataset.i18n] || element.textContent;
  }
  for (const link of document.querySelectorAll('a[href$=".html"], a[href="index.html"]')) {
    const url = new URL(link.href);
    url.searchParams.set("lang", locale);
    link.href = url.href;
  }
  for (const link of document.querySelectorAll("[data-lang]")) {
    link.classList.toggle("active", link.dataset.lang === locale);
  }
})();
