// Editor UI localization — a small, dependency-free, type-safe message catalog.
//
// Design (the "industry approach" that best fits this app): a single key-first
// table where every message id maps to all supported languages at once. This
// makes the table trivial to audit ("is this string translated everywhere?"),
// gives compile-time completeness via `satisfies Record<string, Record<UiLang,
// string>>` (a missing language for any key is a type error), and needs no
// async resource loading — so there is no first-paint flash and no runtime dep.
//
// NOTE: this is the *editor UI* language. It is independent of the song-title
// display locale (see model/songlist.ts `Locale`), which chooses which game
// metadata locale to render and includes Korean.
//
// To add a string: add one row below. To add a language: add its code to
// `UI_LANGUAGES` + `UiLang` and TypeScript will flag every row that needs it.

export type UiLang = 'en' | 'ja' | 'zh-Hans' | 'zh-Hant';

export const UI_LANGUAGES: { code: UiLang; label: string; short: string }[] = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ja', label: '日本語', short: '日' },
  { code: 'zh-Hans', label: '简体中文', short: '简' },
  { code: 'zh-Hant', label: '繁體中文', short: '繁' },
];

export const DEFAULT_UI_LANG: UiLang = 'en';

/** Best-effort match of the browser's language to one of ours. */
export function detectDefaultUiLang(nav?: { language?: string; languages?: readonly string[] }): UiLang {
  const source = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const tags = [source?.language, ...(source?.languages ?? [])].filter(Boolean) as string[];
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('zh')) {
      // Traditional for TW/HK/MO or an explicit Hant subtag; Simplified otherwise.
      if (/(^|-)(hant|tw|hk|mo)(-|$)/.test(tag)) return 'zh-Hant';
      return 'zh-Hans';
    }
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_UI_LANG;
}

export function isUiLang(v: unknown): v is UiLang {
  return typeof v === 'string' && UI_LANGUAGES.some((l) => l.code === v);
}

// ── The message table (key-first: one row = one string in all languages) ──────
export const messages = {
  // Brand / shell
  'brand.tagline': {
    en: 'Taiko Song & Chart Editor',
    ja: '太鼓楽曲・譜面エディター',
    'zh-Hans': '太鼓乐曲与谱面编辑器',
    'zh-Hant': '太鼓樂曲與譜面編輯器',
  },
  'nav.songs': { en: 'Editor', ja: 'エディター', 'zh-Hans': '编辑器', 'zh-Hant': '编辑器' },
  'nav.order': {
    en: 'Music Order',
    ja: '曲順',
    'zh-Hans': '乐曲顺序',
    'zh-Hant': '樂曲順序',
  },
  'nav.dani': {
    en: 'Dani Dojo',
    ja: '段位道場',
    'zh-Hans': '段位道场',
    'zh-Hant': '段位道場',
  },

  // Page header (per-page save toolbar)
  'songs.editorTitle': { en: 'Song Editor', ja: '楽曲エディター', 'zh-Hans': '乐曲编辑器', 'zh-Hant': '樂曲編輯器' },
  'songs.pageHint': {
    en: "edit each song's metadata, charts & audio",
    ja: '各楽曲のメタデータ・譜面・音源を編集',
    'zh-Hans': '编辑每首乐曲的元数据、谱面与音频',
    'zh-Hant': '編輯每首樂曲的中繼資料、譜面與音訊',
  },
  'dani.pageHint': {
    en: "set each rank's three songs & clear criteria",
    ja: '各段位の3曲と合格条件を設定',
    'zh-Hans': '设置每个段位的三首乐曲与合格条件',
    'zh-Hant': '設定每個段位的三首樂曲與合格條件',
  },

  // Language picker
  'lang.label': { en: 'Language', ja: '言語', 'zh-Hans': '语言', 'zh-Hant': '語言' },
  'lang.tooltip': {
    en: 'Editor display language',
    ja: 'エディターの表示言語',
    'zh-Hans': '编辑器显示语言',
    'zh-Hant': '編輯器顯示語言',
  },

  // Songs / Metadata
  'common.off': { en: 'Off', ja: 'オフ', 'zh-Hans': '关', 'zh-Hant': '關' },
  'common.on': { en: 'On', ja: 'オン', 'zh-Hans': '开', 'zh-Hant': '開' },
  'metadata.edited': {
    en: 'Edited — unsaved', ja: '編集済み — 未保存',
    'zh-Hans': '已编辑—未保存', 'zh-Hant': '已編輯—未儲存',
  },
  'metadata.section.identity': { en: 'Song identity', ja: '楽曲情報', 'zh-Hans': '歌曲标识', 'zh-Hant': '歌曲識別' },
  'metadata.section.settings': { en: 'Song settings', ja: '楽曲設定', 'zh-Hans': '歌曲设置', 'zh-Hant': '歌曲設定' },
  'metadata.section.chart': {
    en: 'Difficulty & chart metadata', ja: '難易度・譜面メタデータ',
    'zh-Hans': '难度与谱面元数据', 'zh-Hant': '難度與譜面後設資料',
  },
  'metadata.section.shinuchi': { en: 'Shin-uchi scoring', ja: '真打スコア', 'zh-Hans': '真打计分', 'zh-Hant': '真打計分' },
  'metadata.section.titles': { en: 'Titles & subtitles', ja: 'タイトル・サブタイトル', 'zh-Hans': '标题与副标题', 'zh-Hant': '標題與副標題' },
  'metadata.songNo': { en: 'Song No.', ja: '楽曲番号', 'zh-Hans': '歌曲编号', 'zh-Hant': '歌曲編號' },
  'metadata.songId': { en: 'Song ID', ja: '楽曲 ID', 'zh-Hans': '歌曲 ID', 'zh-Hant': '歌曲 ID' },
  'metadata.genre': { en: 'Genre', ja: 'ジャンル', 'zh-Hans': '类别', 'zh-Hant': '類別' },
  'metadata.initialBpm': { en: 'Initial BPM', ja: '初期 BPM', 'zh-Hans': '初始 BPM', 'zh-Hant': '初始 BPM' },
  'metadata.papamama': { en: 'Papa/Mama support', ja: 'パパママ対応', 'zh-Hans': '亲子模式支持', 'zh-Hant': '親子模式支援' },
  'metadata.uraEnabled': { en: 'Enable Ura Oni metadata', ja: 'おに（裏）のメタデータを有効化', 'zh-Hans': '启用里魔王元数据', 'zh-Hant': '啟用裏魔王後設資料' },
  'metadata.uraEnableHint': {
    en: 'Controls Ura metadata availability. The chart file is created separately in the chart editor.',
    ja: 'おに（裏）のメタデータを有効化します。譜面ファイルは譜面エディターで別途作成します。',
    'zh-Hans': '控制里魔王元数据是否可用。谱面文件需在谱面编辑器中单独创建。',
    'zh-Hant': '控制裏魔王後設資料是否可用。譜面檔案需在譜面編輯器中另外建立。',
  },
  'metadata.uraChartNotEnabledWarning': {
    en: 'This Ura Oni chart exists but is not enabled in Metadata. To be playable in-game, enable Ura Oni in the Metadata tab.',
    ja: 'このおに（裏）譜面は存在しますが、メタデータで有効になっていません。ゲームでプレイ可能にするには、メタデータタブでおに（裏）を有効にしてください。',
    'zh-Hans': '此里魔王谱面已创建，但未在元数据中启用。要在游戏中可玩，请在元数据标签页启用里魔王。',
    'zh-Hant': '此裏魔王譜面已建立，但未在後設資料中啟用。若要在遊戲中可玩，請在後設資料分頁啟用裏魔王。',
  },
  'metadata.uraChartCreateHint': {
    en: 'Create an Ura Oni chart by cloning Oni.',
    ja: 'おに譜面を複製しておに（裏）譜面を作成します。',
    'zh-Hans': '复制魔王谱面来创建里魔王谱面。',
    'zh-Hant': '複製魔王譜面來建立裏魔王譜面。',
  },
  'metadata.uraChartDeleteHint': {
    en: 'Delete the Ura Oni chart; it will be permanently removed when saved.',
    ja: 'おに（裏）譜面を削除します。保存時に完全に削除されます。',
    'zh-Hans': '删除里魔王谱面；保存时会将其永久删除。',
    'zh-Hant': '刪除裏魔王譜面；儲存時會將其永久刪除。',
  },
  'metadata.uraChartRequiresOniHint': {
    en: 'Add an Oni chart first.',
    ja: '先におに譜面を追加してください。',
    'zh-Hans': '请先添加魔王谱面。',
    'zh-Hant': '請先新增魔王譜面。',
  },
  'metadata.chartCreateHint': {
    en: 'Create a blank {difficulty} chart to author from scratch.',
    ja: '空の{difficulty}譜面を作成して一から作譜します。',
    'zh-Hans': '创建空白{difficulty}谱面，从零开始编谱。',
    'zh-Hant': '建立空白{difficulty}譜面，從零開始編譜。',
  },
  'metadata.chartDerivedHint': {
    en: 'Calculated from the chart and not edited directly in musicinfo.',
    ja: '譜面から算出されるため、musicinfo では直接編集できません。',
    'zh-Hans': '由谱面计算，不可在 musicinfo 中直接编辑。',
    'zh-Hant': '由譜面計算，不可在 musicinfo 中直接編輯。',
  },
  'metadata.branchDerivedHint': {
    en: 'Synchronized with Branched chart in the chart Inspector.',
    ja: '譜面インスペクターの「分岐譜面」と同期します。',
    'zh-Hans': '与谱面检查器中的“分歧谱面”同步。',
    'zh-Hant': '與譜面檢查器中的「分歧譜面」同步。',
  },
  'metadata.field': { en: 'Field', ja: '項目', 'zh-Hans': '字段', 'zh-Hant': '欄位' },
  'metadata.difficulty.easy': { en: 'Easy', ja: 'かんたん', 'zh-Hans': '简单', 'zh-Hant': '簡單' },
  'metadata.difficulty.normal': { en: 'Normal', ja: 'ふつう', 'zh-Hans': '普通', 'zh-Hant': '普通' },
  'metadata.difficulty.hard': { en: 'Hard', ja: 'むずかしい', 'zh-Hans': '困难', 'zh-Hant': '困難' },
  'metadata.difficulty.oni': { en: 'Oni', ja: 'おに', 'zh-Hans': '魔王', 'zh-Hant': '魔王' },
  'metadata.difficulty.ura': { en: 'Ura Oni', ja: 'おに（裏）', 'zh-Hans': '里魔王', 'zh-Hant': '裏魔王' },
  'songmeta.starRating': {
    en: '{difficulty}: ★{stars}', ja: '{difficulty}：★{stars}',
    'zh-Hans': '{difficulty}：★{stars}', 'zh-Hant': '{difficulty}：★{stars}',
  },
  'metadata.stars': { en: 'Stars', ja: '星数', 'zh-Hans': '星级', 'zh-Hant': '星級' },
  'metadata.branchRoutes': { en: 'Branch routes', ja: '譜面分岐', 'zh-Hans': '谱面分歧', 'zh-Hant': '譜面分歧' },
  'metadata.noteCount': { en: 'Note count', ja: '音符数', 'zh-Hans': '音符数', 'zh-Hant': '音符數' },
  'metadata.drumrollTime': { en: 'Drumroll time', ja: '連打時間', 'zh-Hans': '连打时间', 'zh-Hant': '連打時間' },
  'metadata.balloonTotal': { en: 'Balloon total', ja: '風船合計', 'zh-Hans': '气球合计', 'zh-Hant': '氣球合計' },
  'metadata.spikeFlag': { en: 'Spike flag', ja: 'スパイクフラグ', 'zh-Hans': 'Spike 标志', 'zh-Hant': 'Spike 標誌' },
  'metadata.spikeHint': {
    en: 'Raw game flag. In this corpus it is enabled only on Easy for Time Traveler and SEITEN NO REIMEI; its exact runtime effect is unconfirmed.',
    ja: 'ゲーム内部の生フラグです。このデータでは「タイムトラベラー」と「青天の黎明」の「かんたん」だけが有効で、実際の効果は未確認です。',
    'zh-Hans': '游戏内部原始标志。本数据中仅《Time Traveler》和《青天之黎明》的“简单”难度启用，具体运行效果尚未确认。',
    'zh-Hant': '遊戲內部原始標誌。本資料中僅《Time Traveler》和《青天之黎明》的「簡單」難度啟用，實際運作效果尚未確認。',
  },
  'metadata.baseScore': { en: 'Base score', ja: '基本スコア', 'zh-Hans': '基础得分', 'zh-Hant': '基礎得分' },
  'metadata.baseScoreDuet': { en: 'Base score · duet', ja: '基本スコア・デュエット', 'zh-Hans': '基础得分·双人', 'zh-Hant': '基礎得分·雙人' },
  'metadata.targetScore': { en: 'Target score', ja: '目標スコア', 'zh-Hans': '目标得分', 'zh-Hant': '目標得分' },
  'metadata.targetScoreDuet': { en: 'Target score · duet', ja: '目標スコア・デュエット', 'zh-Hans': '目标得分·双人', 'zh-Hant': '目標得分·雙人' },
  'metadata.locale': { en: 'Locale', ja: '言語', 'zh-Hans': '语言', 'zh-Hant': '語言' },
  'metadata.title': { en: 'Title', ja: 'タイトル', 'zh-Hans': '标题', 'zh-Hant': '標題' },
  'metadata.subtitle': { en: 'Subtitle', ja: 'サブタイトル', 'zh-Hans': '副标题', 'zh-Hant': '副標題' },

  // Genre labels used by Metadata
  'genre.pops': { en: 'Pops', ja: 'ポップス', 'zh-Hans': '流行音乐', 'zh-Hant': '流行音樂' },
  'genre.anime': { en: 'Anime', ja: 'アニメ', 'zh-Hans': '动画', 'zh-Hant': '動畫' },
  'genre.kids': { en: 'Kids', ja: 'キッズ', 'zh-Hans': '儿童', 'zh-Hant': '兒童' },
  'genre.vocaloid': { en: 'Vocaloid', ja: 'ボーカロイド', 'zh-Hans': 'VOCALOID', 'zh-Hant': 'VOCALOID' },
  'genre.gameMusic': { en: 'Game Music', ja: 'ゲームミュージック', 'zh-Hans': '游戏音乐', 'zh-Hant': '遊戲音樂' },
  'genre.namcoOriginal': { en: 'Namco Original', ja: 'ナムコオリジナル', 'zh-Hans': '南梦宫原创', 'zh-Hant': 'NAMCO 原創' },
  'genre.variety': { en: 'Variety', ja: 'バラエティ', 'zh-Hans': '综合', 'zh-Hant': '綜合' },
  'genre.classical': { en: 'Classical', ja: 'クラシック', 'zh-Hans': '古典音乐', 'zh-Hant': '古典音樂' },
  'genre.unknown': { en: 'Unknown', ja: '不明', 'zh-Hans': '未知', 'zh-Hant': '未知' },

  // Project setup (Settings)
  'setup.step1.title': {
    en: 'Select the game Data folder',
    ja: 'ゲームの Data フォルダーを選択',
    'zh-Hans': '选择游戏 Data 文件夹',
    'zh-Hant': '選擇遊戲 Data 資料夾',
  },
  'setup.step1.button': {
    en: 'Select folder…',
    ja: 'フォルダーを選択…',
    'zh-Hans': '选择文件夹…',
    'zh-Hant': '選擇資料夾…',
  },
  'setup.step1.change': {
    en: 'Change',
    ja: '変更',
    'zh-Hans': '更改',
    'zh-Hant': '變更',
  },

  'setup.step2.datatableKey': {
    en: 'Datatable key',
    ja: 'データテーブルキー',
    'zh-Hans': '数据表密钥',
    'zh-Hant': '資料表金鑰',
  },
  'setup.step2.fumenKey': {
    en: 'Fumen (chart) key',
    ja: '譜面キー',
    'zh-Hans': '谱面密钥',
    'zh-Hant': '譜面金鑰',
  },
  'setup.step2.placeholder': {
    en: '64 hex characters',
    ja: '64 桁の 16 進数',
    'zh-Hans': '64 位十六进制字符',
    'zh-Hant': '64 位十六進位字元',
  },

  'setup.step3.button': {
    en: 'Load Project',
    ja: 'プロジェクトを読み込む',
    'zh-Hans': '加载项目',
    'zh-Hant': '載入專案',
  },
  'setup.opening': {
    en: 'Loading…',
    ja: '読み込み中…',
    'zh-Hans': '正在加载…',
    'zh-Hant': '正在載入…',
  },

  // Validation "breadcrust"
  'setup.error.title': {
    en: 'Couldn’t open the project',
    ja: 'プロジェクトを開けませんでした',
    'zh-Hans': '无法打开项目',
    'zh-Hant': '無法開啟專案',
  },
  'setup.error.folder': {
    en: 'That folder doesn’t look like a Taiko install — pick the game’s Data folder (it should contain x64/ with datatable/, fumen/ and sound/).',
    ja: 'このフォルダーは Taiko のインストールではないようです。ゲームの Data フォルダー（datatable/・fumen/・sound/ を含む x64/ があるもの）を選択してください。',
    'zh-Hans': '该文件夹看起来不是 Taiko 安装目录——请选择游戏的 Data 文件夹（其中应包含带 datatable/、fumen/、sound/ 的 x64/）。',
    'zh-Hant': '此資料夾看起來不是 Taiko 安裝目錄——請選擇遊戲的 Data 資料夾（其中應包含帶 datatable/、fumen/、sound/ 的 x64/）。',
  },
  'setup.error.datatableKey': {
    en: 'The datatable key looks incorrect — the datatables didn’t decrypt.',
    ja: 'データテーブルキーが正しくないようです（データテーブルを復号できませんでした）。',
    'zh-Hans': '数据表密钥似乎不正确——无法解密数据表。',
    'zh-Hant': '資料表金鑰似乎不正確——無法解密資料表。',
  },
  'setup.error.fumenKey': {
    en: 'The fumen key looks incorrect — the charts didn’t decrypt.',
    ja: '譜面キーが正しくないようです（譜面を復号できませんでした）。',
    'zh-Hans': '谱面密钥似乎不正确——无法解密谱面。',
    'zh-Hant': '譜面金鑰似乎不正確——無法解密譜面。',
  },
  'setup.error.datatableKeyFormat': {
    en: 'The datatable key must be 64 hexadecimal characters.',
    ja: 'データテーブルキーは 64 桁の 16 進数である必要があります。',
    'zh-Hans': '数据表密钥必须为 64 位十六进制字符。',
    'zh-Hant': '資料表金鑰必須為 64 位十六進位字元。',
  },
  'setup.error.fumenKeyFormat': {
    en: 'The fumen key must be 64 hexadecimal characters.',
    ja: '譜面キーは 64 桁の 16 進数である必要があります。',
    'zh-Hans': '谱面密钥必须为 64 位十六进制字符。',
    'zh-Hant': '譜面金鑰必須為 64 位十六進位字元。',
  },
  'setup.error.generic': {
    en: 'Something went wrong while opening the project.',
    ja: 'プロジェクトを開く際に問題が発生しました。',
    'zh-Hans': '打开项目时出现问题。',
    'zh-Hant': '開啟專案時發生問題。',
  },
  'setup.error.checkHint': {
    en: 'Double-check both keys and the selected folder, then try again.',
    ja: '両方のキーと選択したフォルダーを確認してから、もう一度お試しください。',
    'zh-Hans': '请核对两个密钥和所选文件夹，然后重试。',
    'zh-Hant': '請核對兩個金鑰和所選資料夾，然後重試。',
  },

  // Remembered folder (permission lapsed)
  'setup.remembered': {
    en: 'A folder is remembered: {name}. Reconnecting needs permission again.',
    ja: 'フォルダーが記憶されています：{name}。再接続には権限の再付与が必要です。',
    'zh-Hans': '已记住一个文件夹：{name}。重新连接需要再次授予权限。',
    'zh-Hant': '已記住一個資料夾：{name}。重新連線需要再次授予權限。',
  },
  'setup.reconnect': {
    en: 'Reconnect to “{name}”',
    ja: '「{name}」に再接続',
    'zh-Hans': '重新连接到“{name}”',
    'zh-Hant': '重新連線到「{name}」',
  },
  'setup.forget': {
    en: 'Forget',
    ja: '破棄',
    'zh-Hans': '忘记',
    'zh-Hant': '忘記',
  },

  // Settings
  'settings.title': { en: 'Settings', ja: '設定', 'zh-Hans': '设置', 'zh-Hant': '設定' },
  'settings.description': {
    en: 'Configure the game project and optional local audio codec modules.',
    ja: 'ゲームプロジェクトと任意のローカル音声コーデックモジュールを設定します。',
    'zh-Hans': '配置游戏项目和可选的本地音频编解码模块。',
    'zh-Hant': '設定遊戲專案和選用的本機音訊編解碼模組。',
  },
  'settings.project.title': {
    en: 'Game project', ja: 'ゲームプロジェクト',
    'zh-Hans': '游戏项目', 'zh-Hant': '遊戲專案',
  },
  'settings.project.hint': {
    en: 'The folder and both AES keys are required to load and save game data.',
    ja: 'ゲームデータの読み込みと保存には、フォルダーと 2 つの AES キーが必要です。',
    'zh-Hans': '加载和保存游戏数据需要文件夹和两个 AES 密钥。',
    'zh-Hant': '載入和儲存遊戲資料需要資料夾和兩個 AES 金鑰。',
  },
  'settings.project.open': {
    en: 'Project open', ja: 'プロジェクトを開いています',
    'zh-Hans': '项目已打开', 'zh-Hant': '專案已開啟',
  },
  'settings.project.close': {
    en: 'Close Project', ja: 'プロジェクトを閉じる',
    'zh-Hans': '关闭项目', 'zh-Hant': '關閉專案',
  },
  'settings.project.exportBundle': {
    en: 'Export bundle', ja: 'バンドルをエクスポート',
    'zh-Hans': '导出捆绑包', 'zh-Hant': '匯出套件',
  },
  'settings.project.closeConfirm': {
    en: 'Close the project without saving?',
    ja: '保存せずにプロジェクトを閉じますか？',
    'zh-Hans': '不保存就关闭项目？',
    'zh-Hant': '不儲存就關閉專案？',
  },
  'settings.project.closeUnsaved.one': {
    en: '{n} unsaved edit will be discarded.',
    ja: '未保存の編集 {n} 件が破棄されます。',
    'zh-Hans': '将丢弃 {n} 项未保存的编辑。',
    'zh-Hant': '將捨棄 {n} 項未儲存的編輯。',
  },
  'settings.project.closeUnsaved.other': {
    en: '{n} unsaved edits will be discarded.',
    ja: '未保存の編集 {n} 件が破棄されます。',
    'zh-Hans': '将丢弃 {n} 项未保存的编辑。',
    'zh-Hant': '將捨棄 {n} 項未儲存的編輯。',
  },
  'settings.project.discardAndClose': {
    en: 'Discard and close', ja: '破棄して閉じる',
    'zh-Hans': '丢弃并关闭', 'zh-Hant': '捨棄並關閉',
  },
  'settings.decoder.title': {
    en: 'G.719 decoder', ja: 'G.719 デコーダー',
    'zh-Hans': 'G.719 解码器', 'zh-Hant': 'G.719 解碼器',
  },
  'settings.decoder.hint': {
    en: 'Add a compatible WASM file to enable BNSF/IS22 playback. It stays in this browser. Editing and saving remain available without it.',
    ja: '互換性のある WASM ファイルを追加すると BNSF/IS22 を再生できます。ファイルはこのブラウザー内に留まります。なくても編集と保存は利用できます。',
    'zh-Hans': '添加兼容的 WASM 文件以启用 BNSF/IS22 播放。该文件仅保存在此浏览器中。没有该文件仍可编辑和保存。',
    'zh-Hant': '新增相容的 WASM 檔案以啟用 BNSF/IS22 播放。該檔案僅保存在此瀏覽器中。沒有該檔案仍可編輯和儲存。',
  },
  'settings.decoder.checking': {
    en: 'Checking…', ja: '確認中…', 'zh-Hans': '正在检查…', 'zh-Hant': '正在檢查…',
  },
  'settings.decoder.ready': {
    en: 'Ready', ja: '利用可能', 'zh-Hans': '可用', 'zh-Hant': '可用',
  },
  'settings.decoder.invalid': {
    en: 'Invalid file', ja: '無効なファイル', 'zh-Hans': '文件无效', 'zh-Hant': '檔案無效',
  },
  'settings.decoder.missing': {
    en: 'Not installed', ja: '未設定', 'zh-Hans': '未安装', 'zh-Hant': '未安裝',
  },
  'settings.decoder.storageError': {
    en: 'Decoder storage is unavailable.',
    ja: 'デコーダー用ストレージを利用できません。',
    'zh-Hans': '解码器存储不可用。',
    'zh-Hant': '解碼器儲存空間不可用。',
  },
  'settings.decoder.fileError': {
    en: 'Couldn’t use that WASM file.',
    ja: 'その WASM ファイルを使用できません。',
    'zh-Hans': '无法使用该 WASM 文件。',
    'zh-Hant': '無法使用該 WASM 檔案。',
  },
  'settings.decoder.choose': {
    en: 'Choose WASM…', ja: 'WASM を選択…',
    'zh-Hans': '选择 WASM…', 'zh-Hant': '選擇 WASM…',
  },
  'settings.decoder.replace': {
    en: 'Replace WASM…', ja: 'WASM を置き換え…',
    'zh-Hans': '替换 WASM…', 'zh-Hant': '取代 WASM…',
  },
  'settings.decoder.remove': {
    en: 'Remove decoder', ja: 'デコーダーを削除',
    'zh-Hans': '移除解码器', 'zh-Hant': '移除解碼器',
  },
  'settings.encoder.title': {
    en: 'G.719 encoder', ja: 'G.719 エンコーダー',
    'zh-Hans': 'G.719 编码器', 'zh-Hant': 'G.719 編碼器',
  },
  'settings.encoder.hint': {
    en: 'Add a compatible encoder WASM to convert OGG, WAV, MP3, and other browser-supported audio into game-native BNSF/IS22. It stays in this browser.',
    ja: '互換性のあるエンコーダー WASM を追加すると、OGG、WAV、MP3 などブラウザー対応の音声をゲーム用 BNSF/IS22 に変換できます。ファイルはこのブラウザー内に留まります。',
    'zh-Hans': '添加兼容的编码器 WASM，即可将 OGG、WAV、MP3 和其他浏览器支持的音频转换为游戏原生 BNSF/IS22。该文件仅保存在此浏览器中。',
    'zh-Hant': '新增相容的編碼器 WASM，即可將 OGG、WAV、MP3 和其他瀏覽器支援的音訊轉換為遊戲原生 BNSF/IS22。該檔案僅保存在此瀏覽器中。',
  },
  'settings.encoder.checking': {
    en: 'Checking…', ja: '確認中…', 'zh-Hans': '正在检查…', 'zh-Hant': '正在檢查…',
  },
  'settings.encoder.ready': {
    en: 'Ready', ja: '利用可能', 'zh-Hans': '可用', 'zh-Hant': '可用',
  },
  'settings.encoder.invalid': {
    en: 'Invalid file', ja: '無効なファイル', 'zh-Hans': '文件无效', 'zh-Hant': '檔案無效',
  },
  'settings.encoder.missing': {
    en: 'Not installed', ja: '未設定', 'zh-Hans': '未安装', 'zh-Hant': '未安裝',
  },
  'settings.encoder.storageError': {
    en: 'Encoder storage is unavailable.',
    ja: 'エンコーダー用ストレージを利用できません。',
    'zh-Hans': '编码器存储不可用。',
    'zh-Hant': '編碼器儲存空間不可用。',
  },
  'settings.encoder.fileError': {
    en: 'Couldn’t use that WASM file.',
    ja: 'その WASM ファイルを使用できません。',
    'zh-Hans': '无法使用该 WASM 文件。',
    'zh-Hant': '無法使用該 WASM 檔案。',
  },
  'settings.encoder.choose': {
    en: 'Choose WASM…', ja: 'WASM を選択…',
    'zh-Hans': '选择 WASM…', 'zh-Hant': '選擇 WASM…',
  },
  'settings.encoder.replace': {
    en: 'Replace WASM…', ja: 'WASM を置き換え…',
    'zh-Hans': '替换 WASM…', 'zh-Hant': '取代 WASM…',
  },
  'settings.encoder.remove': {
    en: 'Remove encoder', ja: 'エンコーダーを削除',
    'zh-Hans': '移除编码器', 'zh-Hant': '移除編碼器',
  },
  // Shared verbs / actions
  'common.save': { en: 'Save', ja: '保存', 'zh-Hans': '保存', 'zh-Hant': '儲存' },
  'common.cancel': { en: 'Cancel', ja: 'キャンセル', 'zh-Hans': '取消', 'zh-Hant': '取消' },
  'common.delete': { en: 'Delete', ja: '削除', 'zh-Hans': '删除', 'zh-Hant': '刪除' },
  'common.close': { en: 'Close', ja: '閉じる', 'zh-Hans': '关闭', 'zh-Hant': '關閉' },
  'common.add': { en: 'Add', ja: '追加', 'zh-Hans': '添加', 'zh-Hant': '新增' },
  'common.remove': { en: 'Remove', ja: '削除', 'zh-Hans': '移除', 'zh-Hant': '移除' },
  'common.retry': { en: 'Retry', ja: '再試行', 'zh-Hans': '重试', 'zh-Hant': '重試' },
  'common.confirm': { en: 'Continue', ja: '続行', 'zh-Hans': '继续', 'zh-Hant': '繼續' },

  // Editor tabs
  'tabs.metadata': { en: 'Metadata', ja: 'メタデータ', 'zh-Hans': '元数据', 'zh-Hant': '後設資料' },
  'tabs.chart': { en: 'Chart', ja: '譜面', 'zh-Hans': '谱面', 'zh-Hant': '譜面' },
  'tabs.sound': { en: 'Sound', ja: 'サウンド', 'zh-Hans': '音频', 'zh-Hant': '音訊' },

  // Preview-first TJA import
  'importtja.button': { en: 'Import TJA', ja: 'TJAをインポート', 'zh-Hans': '导入 TJA', 'zh-Hant': '匯入 TJA' },
  'importtja.buttonHint': {
    en: 'Preview and import a TJA into the selected song',
    ja: '選択中の楽曲へTJAをプレビューしてインポート',
    'zh-Hans': '预览 TJA 并导入到所选歌曲',
    'zh-Hant': '預覽 TJA 並匯入至所選歌曲',
  },
  'importtja.title': { en: 'Import TJA', ja: 'TJAをインポート', 'zh-Hans': '导入 TJA', 'zh-Hant': '匯入 TJA' },
  'importtja.pill': {
    en: 'Song No. {no} · {id}', ja: '楽曲番号 {no}・{id}',
    'zh-Hans': '歌曲编号 {no} · {id}', 'zh-Hant': '歌曲編號 {no} · {id}',
  },
  'importtja.intro': {
    en: 'Select a TJA file to preview every metadata field and chart file that will be overwritten. Import is one undoable edit; files are written only when you save.',
    ja: 'TJAファイルを選択すると、上書きされる全メタデータ項目と譜面ファイルを確認できます。インポートは1回の操作として元に戻せ、保存するまでファイルには書き込まれません。',
    'zh-Hans': '选择 TJA 文件以预览将被覆盖的全部元数据字段和谱面文件。导入是一次可撤销的编辑；只有保存时才会写入文件。',
    'zh-Hant': '選擇 TJA 檔案以預覽將被覆寫的全部後設資料欄位和譜面檔案。匯入是一次可復原的編輯；只有儲存時才會寫入檔案。',
  },
  'importtja.selectPrompt': { en: 'Select a .tja file', ja: '.tjaファイルを選択', 'zh-Hans': '选择 .tja 文件', 'zh-Hant': '選擇 .tja 檔案' },
  'importtja.selectHint': {
    en: 'UTF-8 and Shift-JIS files are parsed locally. Audio is not imported.',
    ja: 'UTF-8とShift-JISをローカルで解析します。音源はインポートされません。',
    'zh-Hans': '在本地解析 UTF-8 和 Shift-JIS 文件。不导入音频。',
    'zh-Hant': '在本機解析 UTF-8 和 Shift-JIS 檔案。不匯入音訊。',
  },
  'importtja.chooseFile': { en: 'Select TJA…', ja: 'TJAを選択…', 'zh-Hans': '选择 TJA…', 'zh-Hant': '選擇 TJA…' },
  'importtja.chooseAnother': { en: 'Choose another…', ja: '別のファイルを選択…', 'zh-Hans': '选择其他文件…', 'zh-Hant': '選擇其他檔案…' },
  'importtja.parsing': { en: 'Parsing…', ja: '解析中…', 'zh-Hans': '正在解析…', 'zh-Hant': '正在解析…' },
  'importtja.readFailed': {
    en: 'Could not parse the TJA: {message}', ja: 'TJAを解析できませんでした：{message}',
    'zh-Hans': '无法解析 TJA：{message}', 'zh-Hant': '無法解析 TJA：{message}',
  },
  'importtja.chartCount.one': { en: '{n} chart file in preview', ja: 'プレビュー：譜面ファイル{n}個', 'zh-Hans': '预览中有 {n} 个谱面文件', 'zh-Hant': '預覽中有 {n} 個譜面檔案' },
  'importtja.chartCount.other': { en: '{n} chart files in preview', ja: 'プレビュー：譜面ファイル{n}個', 'zh-Hans': '预览中有 {n} 个谱面文件', 'zh-Hant': '預覽中有 {n} 個譜面檔案' },
  'importtja.metadataGroup': { en: 'Metadata to overwrite', ja: '上書きするメタデータ', 'zh-Hans': '将覆盖的元数据', 'zh-Hant': '將覆寫的後設資料' },
  'importtja.noMetadataChanges': { en: 'All imported metadata already matches.', ja: 'インポート対象のメタデータはすべて一致しています。', 'zh-Hans': '所有导入元数据均已一致。', 'zh-Hant': '所有匯入後設資料均已一致。' },
  'importtja.derivedMetadata': {
    en: 'Note counts, branch flags, drumroll time, and balloon totals will also be recalculated from each imported Solo chart.',
    ja: '音符数、譜面分岐、連打時間、風船合計も、インポートした各ソロ譜面から再計算されます。',
    'zh-Hans': '音符数、谱面分歧、连打时间和气球合计也会根据各导入的单人谱面重新计算。',
    'zh-Hant': '音符數、譜面分歧、連打時間和氣球合計也會依各匯入的單人譜面重新計算。',
  },
  'importtja.chartsGroup': { en: 'Chart files to overwrite', ja: '上書きする譜面ファイル', 'zh-Hans': '将覆盖的谱面文件', 'zh-Hant': '將覆寫的譜面檔案' },
  'importtja.replaceChart': { en: 'Replace existing chart', ja: '既存譜面を置換', 'zh-Hans': '替换现有谱面', 'zh-Hant': '取代現有譜面' },
  'importtja.createChart': { en: 'Create chart file', ja: '譜面ファイルを新規作成', 'zh-Hans': '创建谱面文件', 'zh-Hant': '建立譜面檔案' },
  'importtja.removeChart': { en: 'Remove chart not present in this TJA', ja: 'このTJAにない譜面を削除', 'zh-Hans': '移除此 TJA 中不存在的谱面', 'zh-Hant': '移除此 TJA 中不存在的譜面' },
  'importtja.chartSummary': {
    en: '{measures} measures · {notes} note entries · {rolls} drumrolls · {balloons} balloons',
    ja: '{measures}小節・音符{notes}個・連打{rolls}個・風船{balloons}個',
    'zh-Hans': '{measures} 小节 · {notes} 个音符记录 · {rolls} 个连打 · {balloons} 个气球',
    'zh-Hant': '{measures} 小節 · {notes} 個音符記錄 · {rolls} 個連打 · {balloons} 個氣球',
  },
  'importtja.scoreSummary': {
    en: 'Legacy score · base {base} · step {step}', ja: '旧スコア・初項{base}・公差{step}',
    'zh-Hans': '旧计分 · 初项 {base} · 公差 {step}', 'zh-Hant': '舊計分 · 初項 {base} · 公差 {step}',
  },
  'importtja.recoveriesGroup': { en: 'Compatible recoveries', ja: '互換補正', 'zh-Hans': '兼容性修复', 'zh-Hant': '相容性修復' },
  'importtja.recoveryCount': { en: '(×{n})', ja: '（×{n}）', 'zh-Hans': '（×{n}）', 'zh-Hant': '（×{n}）' },
  'importtja.warning.missingOffset': {
    en: 'OFFSET is omitted; 0 seconds will be used.', ja: 'OFFSETがないため、0秒として処理します。',
    'zh-Hans': '未提供 OFFSET；将使用 0 秒。', 'zh-Hant': '未提供 OFFSET；將使用 0 秒。',
  },
  'importtja.warning.specialCourse': {
    en: 'The {detail} course maps to Oni because the official format has no Tower or Dan slot.',
    ja: '公式形式にはTower／Danの枠がないため、{detail}コースをおにへ割り当てます。',
    'zh-Hans': '官方格式没有 Tower 或 Dan 槽位，因此将 {detail} 课程映射到魔王。',
    'zh-Hant': '官方格式沒有 Tower 或 Dan 槽位，因此將 {detail} 課程映射到魔王。',
  },
  'importtja.warning.ignoredCommand': {
    en: 'Unsupported command #{detail} was ignored.', ja: '未対応のコマンド #{detail} を無視しました。',
    'zh-Hans': '已忽略不支持的命令 #{detail}。', 'zh-Hant': '已忽略不支援的指令 #{detail}。',
  },
  'importtja.warning.invalidNote': {
    en: 'Invalid note symbol “{detail}” was ignored.', ja: '不正な音符記号「{detail}」を無視しました。',
    'zh-Hans': '已忽略无效音符符号“{detail}”。', 'zh-Hant': '已忽略無效音符符號「{detail}」。',
  },
  'importtja.warning.branchPadded': {
    en: 'The {detail} branch was padded to match the other routes.', ja: '{detail}分岐を他の譜面に合わせて補完しました。',
    'zh-Hans': '已补齐 {detail} 分支以匹配其他路线。', 'zh-Hant': '已補齊 {detail} 分支以符合其他路線。',
  },
  'importtja.warning.balloonDefaulted': {
    en: 'A missing or invalid balloon hit count was recovered as 1.', ja: '不足または不正な風船打数を1として補完しました。',
    'zh-Hans': '缺失或无效的气球打数已修复为 1。', 'zh-Hant': '缺少或無效的氣球打數已修復為 1。',
  },
  'importtja.warning.orphanRollEnd': {
    en: 'A roll-end note without a matching start was ignored.', ja: '開始音符のない連打終了音符を無視しました。',
    'zh-Hans': '已忽略没有对应起点的连打结束音符。', 'zh-Hant': '已忽略沒有對應起點的連打結束音符。',
  },
  'importtja.warning.overlappingLongNote': {
    en: 'An overlapping drumroll or balloon was closed at the next long note.', ja: '重複した連打または風船を次の長音符位置で終了しました。',
    'zh-Hans': '重叠的连打或气球已在下一个长音符处结束。', 'zh-Hant': '重疊的連打或氣球已在下一個長音符處結束。',
  },
  'importtja.warning.duplicateCourse': {
    en: 'Duplicate course slot {detail}; the representative chart was selected.', ja: 'コース枠{detail}が重複しているため、代表譜面を選択しました。',
    'zh-Hans': '课程槽位 {detail} 重复；已选择代表谱面。', 'zh-Hant': '課程槽位 {detail} 重複；已選擇代表譜面。',
  },
  'importtja.warning.invalidValue': {
    en: 'Invalid {detail} value was recovered with a safe default.', ja: '不正な{detail}値を安全な既定値で補正しました。',
    'zh-Hans': '无效的 {detail} 值已使用安全默认值修复。', 'zh-Hant': '無效的 {detail} 值已使用安全預設值修復。',
  },
  'importtja.audioUnchanged': {
    en: 'Audio is unchanged: the .nus3bank file and demo start remain as they are.',
    ja: '音源は変更されません。.nus3bankファイルと試聴開始位置はそのままです。',
    'zh-Hans': '音频不会更改：.nus3bank 文件和试听起点保持不变。',
    'zh-Hant': '音訊不會變更：.nus3bank 檔案和試聽起點維持不變。',
  },
  'importtja.ready': { en: 'Ready to import', ja: 'インポート準備完了', 'zh-Hans': '可以导入', 'zh-Hant': '可以匯入' },
  'importtja.importAction': { en: 'Import TJA', ja: 'TJAをインポート', 'zh-Hans': '导入 TJA', 'zh-Hant': '匯入 TJA' },
  'importtja.importing': { en: 'Importing…', ja: 'インポート中…', 'zh-Hans': '正在导入…', 'zh-Hant': '正在匯入…' },
  'importtja.importFailed': {
    en: 'Import failed: {message}', ja: 'インポートに失敗しました：{message}',
    'zh-Hans': '导入失败：{message}', 'zh-Hant': '匯入失敗：{message}',
  },

  // Chart-slot (Solo / 2P) selector, shared by ChartSlotSelect and DiffTabs
  'chartslot.label': { en: 'Chart', ja: '譜面', 'zh-Hans': '谱面', 'zh-Hant': '譜面' },
  'chartslot.solo': { en: 'Solo', ja: 'ソロ', 'zh-Hans': '单人', 'zh-Hant': '單人' },
  'chartslot.p1': { en: '2P · P1', ja: '2P · P1', 'zh-Hans': '2P · P1', 'zh-Hant': '2P · P1' },
  'chartslot.p2': { en: '2P · P2', ja: '2P · P2', 'zh-Hans': '2P · P2', 'zh-Hant': '2P · P2' },
  'chartslot.soloTitle': { en: 'Single-player chart', ja: '1人用譜面', 'zh-Hans': '单人谱面', 'zh-Hant': '單人譜面' },
  'chartslot.p1Title': {
    en: 'Two-player chart · player 1', ja: '2人用譜面・1P',
    'zh-Hans': '双人谱面·1P', 'zh-Hant': '雙人譜面·1P',
  },
  'chartslot.p2Title': {
    en: 'Two-player chart · player 2', ja: '2人用譜面・2P',
    'zh-Hans': '双人谱面·2P', 'zh-Hant': '雙人譜面·2P',
  },

  // Branch-focus segment (canonical Taiko branch names 普通/玄人/達人)
  'branch.all': { en: 'All', ja: 'すべて', 'zh-Hans': '全部', 'zh-Hant': '全部' },
  'branch.normal': { en: 'Normal', ja: '普通', 'zh-Hans': '普通', 'zh-Hant': '普通' },
  'branch.expert': { en: 'Expert', ja: '玄人', 'zh-Hans': '玄人', 'zh-Hant': '玄人' },
  'branch.master': { en: 'Master', ja: '達人', 'zh-Hans': '达人', 'zh-Hant': '達人' },
  'branch.label': { en: 'Branch', ja: '分岐', 'zh-Hans': '分歧', 'zh-Hant': '分歧' },
  'branch.editAll': {
    en: 'Edit all branch tracks', ja: 'すべての分岐譜面を編集',
    'zh-Hans': '编辑所有分歧谱面', 'zh-Hant': '編輯所有分歧譜面',
  },
  'branch.editOne': {
    en: 'Edit the {track} track only', ja: '{track}譜面のみを編集',
    'zh-Hans': '仅编辑{track}谱面', 'zh-Hant': '僅編輯{track}譜面',
  },

  // Chart toolbar (tools + snap)
  'toolbar.select': { en: 'Select', ja: '選択', 'zh-Hans': '选择', 'zh-Hant': '選擇' },
  'toolbar.smallDon': { en: 'Small Don', ja: '小ドン', 'zh-Hans': '小咚', 'zh-Hant': '小咚' },
  'toolbar.smallKa': { en: 'Small Ka', ja: '小カッ', 'zh-Hans': '小咔', 'zh-Hant': '小咔' },
  'toolbar.bigDon': { en: 'Big Don', ja: '大ドン', 'zh-Hans': '大咚', 'zh-Hant': '大咚' },
  'toolbar.bigKa': { en: 'Big Ka', ja: '大カッ', 'zh-Hans': '大咔', 'zh-Hant': '大咔' },
  'toolbar.smallDrumroll': { en: 'Small Drumroll', ja: '小連打', 'zh-Hans': '小连打', 'zh-Hant': '小連打' },
  'toolbar.bigDrumroll': { en: 'Big Drumroll', ja: '大連打', 'zh-Hans': '大连打', 'zh-Hant': '大連打' },
  'toolbar.smallBalloon': { en: 'Small Balloon', ja: '風船', 'zh-Hans': '气球', 'zh-Hant': '氣球' },
  'toolbar.bigBalloon': { en: 'Big Balloon', ja: 'くす玉', 'zh-Hans': '彩球', 'zh-Hant': '彩球' },
  'toolbar.eraser': { en: 'Eraser', ja: '消しゴム', 'zh-Hans': '橡皮擦', 'zh-Hant': '橡皮擦' },
  'toolbar.snap': { en: 'Snap', ja: 'スナップ', 'zh-Hans': '吸附', 'zh-Hant': '吸附' },
  'toolbar.showSnapLines': {
    en: 'Show snap lines', ja: 'スナップ線を表示',
    'zh-Hans': '显示吸附线', 'zh-Hant': '顯示吸附線',
  },
  'toolbar.showNoteText': {
    en: 'Show Don/Ka text', ja: 'ドン／カッの文字を表示',
    'zh-Hans': '显示咚／咔文字', 'zh-Hant': '顯示咚／咔文字',
  },
  'toolbar.showNoteTextTitle': {
    en: 'Show Japanese text below hit notes; orange text differs from the recommendation and does not change the chart',
    ja: '音符の下に日本語の文字を表示します。オレンジ色は推奨と異なる表記で、譜面は変更されません',
    'zh-Hans': '在音符下方显示日文文字；橙色表示与建议不同，不会修改谱面',
    'zh-Hant': '在音符下方顯示日文文字；橙色表示與建議不同，不會修改譜面',
  },

  // Chart-canvas states (empty / loading / error)
  'chartstates.pickDiffTitle': {
    en: 'Pick a difficulty to edit', ja: '編集する難易度を選択',
    'zh-Hans': '选择要编辑的难度', 'zh-Hant': '選擇要編輯的難度',
  },
  'chartstates.ships.one': {
    en: '{title} ships {n} chart. Choose one to load its score sheet.',
    ja: '「{title}」には{n}件の譜面があります。読み込む譜面を選んでください。',
    'zh-Hans': '《{title}》有 {n} 个谱面。选择一个以载入其谱面。',
    'zh-Hant': '《{title}》有 {n} 個譜面。選擇一個以載入其譜面。',
  },
  'chartstates.ships.other': {
    en: '{title} ships {n} charts. Choose one to load its score sheet.',
    ja: '「{title}」には{n}件の譜面があります。読み込む譜面を選んでください。',
    'zh-Hans': '《{title}》有 {n} 个谱面。选择一个以载入其谱面。',
    'zh-Hant': '《{title}》有 {n} 個譜面。選擇一個以載入其譜面。',
  },
  'chartstates.noChartsTitle': {
    en: 'No charts for this song', ja: 'この楽曲には譜面がありません',
    'zh-Hans': '此歌曲没有谱面', 'zh-Hant': '此歌曲沒有譜面',
  },
  'chartstates.noChartsBody': {
    en: 'This song has no fumen files on disk yet. Click a difficulty tab above to author a blank chart from scratch, or import one.',
    ja: 'この楽曲にはまだ譜面ファイルがありません。上の難易度タブをクリックして空の譜面を一から作成するか、インポートしてください。',
    'zh-Hans': '此歌曲的磁盘上还没有谱面文件。点击上方难度标签即可从零创建空白谱面，或导入谱面。',
    'zh-Hant': '此歌曲的磁碟上還沒有譜面檔案。點擊上方難度分頁即可從零建立空白譜面，或匯入譜面。',
  },
  'chartstates.decoding': {
    en: 'Decoding {filename} · AES-256 → gzip',
    ja: '{filename} を復号中 · AES-256 → gzip',
    'zh-Hans': '正在解码 {filename} · AES-256 → gzip',
    'zh-Hant': '正在解碼 {filename} · AES-256 → gzip',
  },
  'chartstates.decodeErrorTitle': {
    en: 'Couldn’t decode this chart', ja: 'この譜面を復号できませんでした',
    'zh-Hans': '无法解码此谱面', 'zh-Hant': '無法解碼此譜面',
  },
  'chartstates.retryDecode': { en: 'Retry decode', ja: '再度復号', 'zh-Hans': '重试解码', 'zh-Hant': '重試解碼' },

  // Score-canvas scale sliders
  'scale.timelineTitle': {
    en: 'Timeline zoom — stretches the horizontal time axis',
    ja: 'タイムラインズーム — 横の時間軸を伸縮します',
    'zh-Hans': '时间轴缩放——拉伸水平时间轴',
    'zh-Hant': '時間軸縮放——拉伸水平時間軸',
  },
  'scale.timeline': { en: 'Timeline', ja: 'タイムライン', 'zh-Hans': '时间轴', 'zh-Hant': '時間軸' },
  'scale.noteSizeTitle': {
    en: 'Note size — grows the note glyphs without changing the row layout',
    ja: '音符サイズ — 行レイアウトを変えずに音符を拡大します',
    'zh-Hans': '音符大小——在不改变行布局的情况下放大音符',
    'zh-Hant': '音符大小——在不改變列排版的情況下放大音符',
  },
  'scale.noteSize': { en: 'Note size', ja: '音符サイズ', 'zh-Hans': '音符大小', 'zh-Hant': '音符大小' },

  // Songs area / header
  'songsarea.placeholder': {
    en: 'Select a song from the list.', ja: 'リストから楽曲を選択してください。',
    'zh-Hans': '从列表中选择一首歌曲。', 'zh-Hant': '從列表中選擇一首歌曲。',
  },
  'songheader.deleteTitle': {
    en: 'Delete this song', ja: 'この楽曲を削除',
    'zh-Hans': '删除此歌曲', 'zh-Hant': '刪除此歌曲',
  },

  // Sound tab
  'sound.replacing': {
    en: 'Replacing audio…', ja: '音声を差し替え中…',
    'zh-Hans': '正在替换音频…', 'zh-Hant': '正在替換音訊…',
  },
  'sound.converting': {
    en: 'Converting {file} to game audio…',
    ja: '{file} をゲーム音声に変換中…',
    'zh-Hans': '正在将 {file} 转换为游戏音频…',
    'zh-Hant': '正在將 {file} 轉換為遊戲音訊…',
  },
  'sound.removing': {
    en: 'Removing audio…', ja: '音声を削除中…',
    'zh-Hans': '正在移除音频…', 'zh-Hant': '正在移除音訊…',
  },
  'sound.replaced': {
    en: 'Replaced {file} ({delta}).', ja: '{file} を差し替えました（{delta}）。',
    'zh-Hans': '已替换 {file}（{delta}）。', 'zh-Hant': '已替換 {file}（{delta}）。',
  },
  'sound.converted': {
    en: 'Converted {file} to {bank} ({duration}, {delta}).',
    ja: '{file} を {bank} に変換しました（{duration}、{delta}）。',
    'zh-Hans': '已将 {file} 转换为 {bank}（{duration}，{delta}）。',
    'zh-Hant': '已將 {file} 轉換為 {bank}（{duration}，{delta}）。',
  },
  'sound.encoderMissing': {
    en: 'Add a compatible G.719 encoder in Settings before converting audio.',
    ja: '音声を変換する前に、設定で互換性のある G.719 エンコーダーを追加してください。',
    'zh-Hans': '转换音频前，请先在设置中添加兼容的 G.719 编码器。',
    'zh-Hant': '轉換音訊前，請先在設定中新增相容的 G.719 編碼器。',
  },
  'sound.decodeInputError': {
    en: 'Couldn’t decode {file}. {reason}',
    ja: '{file} をデコードできませんでした。{reason}',
    'zh-Hans': '无法解码 {file}。{reason}',
    'zh-Hant': '無法解碼 {file}。{reason}',
  },
  'sound.encodeInputError': {
    en: 'Couldn’t create game audio. {reason}',
    ja: 'ゲーム音声を作成できませんでした。{reason}',
    'zh-Hans': '无法创建游戏音频。{reason}',
    'zh-Hant': '無法建立遊戲音訊。{reason}',
  },
  'sound.removed': {
    en: 'Removed {file} ({delta}).', ja: '{file} を削除しました（{delta}）。',
    'zh-Hans': '已移除 {file}（{delta}）。', 'zh-Hant': '已移除 {file}（{delta}）。',
  },
  'sound.removeTitle': {
    en: 'Remove audio', ja: '音声を削除',
    'zh-Hans': '移除音频', 'zh-Hant': '移除音訊',
  },
  'sound.removeConfirm': {
    en: 'Permanently remove {path}? The song will be silent until a bank is replaced.',
    ja: '{path} を完全に削除しますか？ 音源を差し替えるまで、この楽曲は無音になります。',
    'zh-Hans': '永久移除 {path}？在替换音源之前，此歌曲将保持静音。',
    'zh-Hant': '永久移除 {path}？在替換音源之前，此歌曲將保持靜音。',
  },
  'sound.noDemoField': {
    en: '{path} does not expose a writable demo-start field.',
    ja: '{path} には書き込み可能なデモ開始フィールドがありません。',
    'zh-Hans': '{path} 没有可写入的试听起点字段。',
    'zh-Hant': '{path} 沒有可寫入的試聽起點欄位。',
  },
  'sound.mono': { en: 'mono', ja: 'モノラル', 'zh-Hans': '单声道', 'zh-Hant': '單聲道' },
  'sound.stereo': { en: 'stereo', ja: 'ステレオ', 'zh-Hans': '立体声', 'zh-Hant': '立體聲' },
  'sound.statusDecoding': { en: 'decoding…', ja: '復号中…', 'zh-Hans': '解码中…', 'zh-Hant': '解碼中…' },
  'sound.statusUnsupported': { en: 'unsupported', ja: '非対応', 'zh-Hans': '不支持', 'zh-Hant': '不支援' },
  'sound.statusMissing': { en: 'missing', ja: 'なし', 'zh-Hans': '缺失', 'zh-Hant': '缺失' },
  'sound.demoStart': { en: 'Demo start', ja: '試聴開始', 'zh-Hans': '试听起点', 'zh-Hant': '試聽起點' },
  'sound.setAsDemoStart': {
    en: 'Set as demo position', ja: '試聴開始位置に設定',
    'zh-Hans': '设为试听起点', 'zh-Hant': '設為試聽起點',
  },
  'sound.play': { en: 'Play', ja: '再生', 'zh-Hans': '播放', 'zh-Hant': '播放' },
  'sound.pause': { en: 'Pause', ja: '一時停止', 'zh-Hans': '暂停', 'zh-Hant': '暫停' },
  'sound.stop': { en: 'Stop', ja: '停止', 'zh-Hans': '停止', 'zh-Hant': '停止' },
  'sound.checking': { en: 'checking', ja: '確認中', 'zh-Hans': '检查中', 'zh-Hant': '檢查中' },
  'sound.onDisk': { en: 'on disk', ja: 'ディスク上', 'zh-Hans': '在磁盘', 'zh-Hant': '在磁碟' },
  'sound.noAudio': { en: 'no audio', ja: '音声なし', 'zh-Hans': '无音频', 'zh-Hant': '無音訊' },
  'sound.byConvention': { en: 'by convention', ja: '規約による', 'zh-Hans': '按约定', 'zh-Hant': '按約定' },
  'sound.size': { en: 'Size', ja: 'サイズ', 'zh-Hans': '大小', 'zh-Hant': '大小' },
  'sound.checkingDots': { en: 'checking…', ja: '確認中…', 'zh-Hans': '检查中…', 'zh-Hant': '檢查中…' },
  'sound.codec': { en: 'Codec', ja: 'コーデック', 'zh-Hans': '编解码器', 'zh-Hant': '編解碼器' },
  'sound.notAvailable': { en: 'not available', ja: '利用不可', 'zh-Hans': '不可用', 'zh-Hant': '不可用' },
  'sound.modified': { en: 'Modified', ja: '更新日時', 'zh-Hans': '修改时间', 'zh-Hant': '修改時間' },
  'sound.decodingBank': {
    en: 'Decoding {filename} · nus3bank → PCM', ja: '{filename} を復号中 · nus3bank → PCM',
    'zh-Hans': '正在解码 {filename} · nus3bank → PCM', 'zh-Hant': '正在解碼 {filename} · nus3bank → PCM',
  },
  'sound.selectToPreview': {
    en: 'Select to preview.', ja: '選択してプレビュー。',
    'zh-Hans': '选择以预览。', 'zh-Hant': '選擇以預覽。',
  },
  'sound.noBankOnDisk': {
    en: 'No audio bank on disk.', ja: 'ディスクに音源バンクがありません。',
    'zh-Hans': '磁盘上没有音源库。', 'zh-Hant': '磁碟上沒有音源庫。',
  },
  'sound.demo': { en: 'Demo', ja: '試聴', 'zh-Hans': '试听', 'zh-Hant': '試聽' },
  'sound.fumenOffset': { en: 'Fumen offset', ja: '譜面オフセット', 'zh-Hans': '谱面偏移', 'zh-Hant': '譜面偏移' },
  'sound.importAudio': {
    en: 'Replace audio…', ja: '音声を差し替え…',
    'zh-Hans': '替换音频…', 'zh-Hant': '替換音訊…',
  },
  'sound.importAudioHint': {
    en: 'Replace with a nus3bank as-is, or convert OGG, WAV, or MP3 to game-native G.719 audio',
    ja: 'nus3bank はそのまま差し替え、OGG・WAV・MP3 はゲーム用 G.719 音声に変換',
    'zh-Hans': '直接以 nus3bank 替换，或将 OGG、WAV 或 MP3 转换为游戏原生 G.719 音频',
    'zh-Hant': '直接以 nus3bank 替換，或將 OGG、WAV 或 MP3 轉換為遊戲原生 G.719 音訊',
  },
  'sound.demoStartHintLabel': {
    en: 'Where demo start is stored', ja: 'デモ開始位置の保存先',
    'zh-Hans': '试听起点的存储位置', 'zh-Hant': '試聽起點的儲存位置',
  },
  'sound.demoStartHintBody': {
    en: 'The demo/preview start point is stored in this song’s sound bank (.nus3bank) file — a single value shared by every difficulty.',
    ja: 'デモ（試聴）開始位置は、この楽曲のサウンドバンク（.nus3bank）ファイルに保存されます。すべての難易度で共通の 1 つの値です。',
    'zh-Hans': '试听/预览起点保存在此歌曲的音源库（.nus3bank）文件中——所有难度共用一个值。',
    'zh-Hant': '試聽/預覽起點儲存在此歌曲的音源庫（.nus3bank）檔案中——所有難度共用一個值。',
  },
  'sound.fumenOffsetHintLabel': {
    en: 'How fumen offset is saved', ja: '譜面オフセットの保存方法',
    'zh-Hans': '谱面偏移的保存方式', 'zh-Hant': '譜面偏移的儲存方式',
  },
  'sound.fumenOffsetHintBody': {
    en: 'The first-measure audio offset lives in each chart (.bin) file. Editing it here writes the same value to every difficulty and player chart of this song, since they share one offset.',
    ja: '第 1 小節のオーディオオフセットは各譜面（.bin）ファイルに保存されます。ここで編集すると、この楽曲のすべての難易度・プレイヤー譜面に同じ値が書き込まれます（オフセットは共通のため）。',
    'zh-Hans': '第一小节的音频偏移保存在每个谱面（.bin）文件中。在此编辑会将相同的值写入此歌曲的所有难度和玩家谱面，因为它们共用一个偏移。',
    'zh-Hant': '第一小節的音訊偏移儲存在每個譜面（.bin）檔案中。在此編輯會將相同的值寫入此歌曲的所有難度與玩家譜面，因為它們共用一個偏移。',
  },
  'sound.stub': {
    en: 'The chart follows the audio here — pick a difficulty on the Chart tab to sync the playhead. Demo start is read from the sound bank; fumen offset is read from the selected chart.',
    ja: '譜面はここでオーディオに追従します。再生ヘッドを同期するには、譜面タブで難易度を選んでください。デモ開始はサウンドバンクから、譜面オフセットは選択中の譜面から読み込まれます。',
    'zh-Hans': '谱面在此跟随音频——在谱面标签页选择一个难度以同步播放头。试听起点从音源库读取；谱面偏移从所选谱面读取。',
    'zh-Hant': '譜面在此跟隨音訊——在譜面分頁選擇一個難度以同步播放頭。試聽起點從音源庫讀取；譜面偏移從所選譜面讀取。',
  },

  // App shell / loading
  'app.opening': {
    en: 'Opening project…', ja: 'プロジェクトを開いています…',
    'zh-Hans': '正在打开项目…', 'zh-Hant': '正在開啟專案…',
  },

  // Browser support gate
  'browsergate.title': {
    en: 'Unsupported browser', ja: '非対応のブラウザ',
    'zh-Hans': '不支持的浏览器', 'zh-Hant': '不支援的瀏覽器',
  },
  'browsergate.missing': {
    en: 'Missing: {list}', ja: '不足している機能: {list}',
    'zh-Hans': '缺少：{list}', 'zh-Hant': '缺少：{list}',
  },
  'browsergate.body': {
    en: 'Bachi needs the File System Access API. Try the latest Google Chrome, Microsoft Edge, Brave, Arc, or Opera.',
    ja: 'Bachi には File System Access API が必要です。最新の Google Chrome、Microsoft Edge、Brave、Arc、Opera をお試しください。',
    'zh-Hans': 'Bachi 需要文件系统访问 API（File System Access API）。请尝试最新版的 Google Chrome、Microsoft Edge、Brave、Arc 或 Opera。',
    'zh-Hant': 'Bachi 需要檔案系統存取 API（File System Access API）。請嘗試最新版的 Google Chrome、Microsoft Edge、Brave、Arc 或 Opera。',
  },

  // Disclosure section
  'disc.editedInSection': {
    en: 'Edited in this section', ja: 'このセクションで編集済み',
    'zh-Hans': '本节已编辑', 'zh-Hant': '本節已編輯',
  },

  // Theme toggle
  'theme.toLight': {
    en: 'Switch to light mode', ja: 'ライトモードに切り替え',
    'zh-Hans': '切换到浅色模式', 'zh-Hant': '切換到淺色模式',
  },
  'theme.toDark': {
    en: 'Switch to dark mode', ja: 'ダークモードに切り替え',
    'zh-Hans': '切换到深色模式', 'zh-Hant': '切換到深色模式',
  },
  'theme.toggle': {
    en: 'Toggle dark mode', ja: 'ダークモードを切り替え',
    'zh-Hans': '切换深色模式', 'zh-Hant': '切換深色模式',
  },

  // Info hint
  'infohint.more': { en: 'More info', ja: '詳細', 'zh-Hans': '更多信息', 'zh-Hant': '更多資訊' },

  // Status bar (chart)
  'statusbar.notes': { en: 'Notes', ja: 'ノーツ', 'zh-Hans': '音符', 'zh-Hant': '音符' },
  'statusbar.noProject': {
    en: 'No game project open', ja: 'ゲームプロジェクトが開かれていません',
    'zh-Hans': '未打开游戏项目', 'zh-Hant': '未開啟遊戲專案',
  },
  'statusbar.measure': { en: 'Measure', ja: '小節', 'zh-Hans': '小节', 'zh-Hant': '小節' },
  'statusbar.codecOk': {
    en: 'codec round-trip OK', ja: 'コーデック往復 OK',
    'zh-Hans': '编解码往返 OK', 'zh-Hant': '編解碼往返 OK',
  },
  'statusbar.codecFailed': {
    en: 'codec round-trip FAILED', ja: 'コーデック往復 失敗',
    'zh-Hans': '编解码往返 失败', 'zh-Hant': '編解碼往返 失敗',
  },

  // Status path (copy hint)
  'statuspath.copyHint': {
    en: '{mod}-click to copy path', ja: '{mod}+クリックでパスをコピー',
    'zh-Hans': '{mod}+点击复制路径', 'zh-Hant': '{mod}+點擊複製路徑',
  },
  'statuspath.copied': { en: 'copied ✓', ja: 'コピー済み ✓', 'zh-Hans': '已复制 ✓', 'zh-Hant': '已複製 ✓' },

  // Top bar
  'topbar.serverBundleReady': {
    en: 'server bundle ready', ja: 'サーバーバンドル準備完了',
    'zh-Hans': '服务器捆绑包就绪', 'zh-Hant': '伺服器套件就緒',
  },
  'topbar.serverBundleReadyTitle': {
    en: 'Server bundle ready — export now', ja: 'サーバーバンドル準備完了 — 今すぐエクスポート',
    'zh-Hans': '服务器捆绑包就绪——立即导出', 'zh-Hant': '伺服器套件就緒——立即匯出',
  },
  'topbar.undoRedo': { en: 'Undo / Redo', ja: '元に戻す / やり直し', 'zh-Hans': '撤销 / 重做', 'zh-Hant': '復原 / 重做' },
  'topbar.undoTitle': { en: 'Undo (⌘Z)', ja: '元に戻す (⌘Z)', 'zh-Hans': '撤销 (⌘Z)', 'zh-Hant': '復原 (⌘Z)' },
  'topbar.redoTitle': { en: 'Redo (⌘⇧Z)', ja: 'やり直し (⌘⇧Z)', 'zh-Hans': '重做 (⌘⇧Z)', 'zh-Hant': '重做 (⌘⇧Z)' },
  'topbar.reviewSave': {
    en: 'Review & save (⌘S)', ja: '確認して保存 (⌘S)',
    'zh-Hans': '查看并保存 (⌘S)', 'zh-Hant': '檢視並儲存 (⌘S)',
  },
  'topbar.noUnsaved': {
    en: 'No unsaved edits', ja: '未保存の編集はありません',
    'zh-Hans': '没有未保存的编辑', 'zh-Hant': '沒有未儲存的編輯',
  },
  'topbar.settings': { en: 'Settings', ja: '設定', 'zh-Hans': '设置', 'zh-Hant': '設定' },
  'topbar.menu': { en: 'More', ja: 'その他', 'zh-Hans': '更多', 'zh-Hant': '更多' },
  'topbar.about': { en: 'About', ja: 'Bachi について', 'zh-Hans': '关于', 'zh-Hant': '關於' },

  // About / welcome modal
  'about.welcome': {
    en: 'Welcome to Bachi', ja: 'Bachi へようこそ',
    'zh-Hans': '欢迎使用 Bachi', 'zh-Hant': '歡迎使用 Bachi',
  },
  'about.intro': {
    en: 'A browser-only editor for Taiko no Tatsujin Nijiiro song data — metadata, charts, music order, dan courses, and audio, all edited straight on your own files.',
    ja: '太鼓の達人ニジイロの楽曲データをブラウザだけで編集するエディターです。メタデータ・譜面・曲順・段位・音源を、手元のファイルに直接編集できます。',
    'zh-Hans': '一款纯浏览器的《太鼓之达人 虹色》乐曲数据编辑器——元数据、谱面、乐曲顺序、段位与音频，全部直接在你自己的文件上编辑。',
    'zh-Hant': '一款純瀏覽器的《太鼓之達人 虹色》樂曲資料編輯器——中繼資料、譜面、樂曲順序、段位與音訊，全部直接在你自己的檔案上編輯。',
  },
  'about.alphaTitle': {
    en: 'Alpha software — keep backups',
    ja: 'アルファ版です — バックアップを取ってください',
    'zh-Hans': '内测阶段软件——请保留备份',
    'zh-Hant': '內測階段軟體——請保留備份',
  },
  'about.alphaBody': {
    en: 'Bachi writes to your game files in place, and saves are not transactional as a group. It is still in alpha, so bugs can corrupt or lose data. Always keep a separate copy of any data you care about before editing it.',
    ja: 'Bachi はゲームファイルを直接上書きし、複数ファイルの保存はまとめてロールバックできません。まだアルファ版のため、不具合によりデータが破損・消失する可能性があります。編集前に必ず別の場所へコピーを保管してください。',
    'zh-Hans': 'Bachi 会就地写入你的游戏文件，且多文件保存并非作为一个整体事务提交。它仍处于内测阶段，缺陷可能导致数据损坏或丢失。编辑前请务必另行保留一份副本。',
    'zh-Hant': 'Bachi 會就地寫入你的遊戲檔案，且多檔案儲存並非作為一個整體交易提交。它仍處於內測階段，缺陷可能導致資料損毀或遺失。編輯前請務必另行保留一份副本。',
  },
  'about.feedback': {
    en: 'Feature requests and bug reports are welcome:',
    ja: '機能のご要望や不具合のご報告はこちらへ:',
    'zh-Hans': '欢迎提交功能建议与缺陷报告：',
    'zh-Hant': '歡迎提交功能建議與缺陷回報：',
  },
  'about.feedbackLink': {
    en: 'open an issue on GitHub', ja: 'GitHub の Issue を作成',
    'zh-Hans': '在 GitHub 上提交 issue', 'zh-Hant': '在 GitHub 上提交 issue',
  },
  'about.featuresTitle': {
    en: 'What Bachi does', ja: 'Bachi でできること',
    'zh-Hans': 'Bachi 能做什么', 'zh-Hant': 'Bachi 能做什麼',
  },
  'about.feature.inPlace': {
    en: 'Edits files in place', ja: 'ファイルを直接編集',
    'zh-Hans': '就地编辑文件', 'zh-Hant': '就地編輯檔案',
  },
  'about.feature.inPlaceBody': {
    en: 'Your game folder stays the single source of truth — no import step, no project format, no export dance.',
    ja: 'ゲームフォルダーがそのまま唯一の正となります。インポートも独自プロジェクト形式もエクスポート作業も不要です。',
    'zh-Hans': '你的游戏文件夹始终是唯一的事实来源——无需导入步骤、无需项目格式、无需导出流程。',
    'zh-Hant': '你的遊戲資料夾始終是唯一的事實來源——無需匯入步驟、無需專案格式、無需匯出流程。',
  },
  'about.feature.noInstall': {
    en: 'Open the box and go', ja: '開いてすぐ使える',
    'zh-Hans': '开箱即用', 'zh-Hant': '開箱即用',
  },
  'about.feature.noInstallBody': {
    en: 'Nothing to install and nothing to update — a Chromium browser is the whole requirement.',
    ja: 'インストールも更新作業も不要。必要なのは Chromium 系ブラウザだけです。',
    'zh-Hans': '无需安装、无需更新——只要一个 Chromium 内核浏览器即可。',
    'zh-Hant': '無需安裝、無需更新——只要一個 Chromium 核心瀏覽器即可。',
  },
  'about.feature.local': {
    en: 'Your data never leaves your machine',
    ja: 'データは端末の外に出ません',
    'zh-Hans': '数据永不离开你的设备',
    'zh-Hant': '資料永不離開你的裝置',
  },
  'about.feature.localBody': {
    en: 'There is no application backend. Decoding, editing, and saving all happen in the browser; nothing is uploaded.',
    ja: 'アプリケーションのバックエンドはありません。復号・編集・保存はすべてブラウザ内で行われ、何もアップロードされません。',
    'zh-Hans': '本应用没有后端。解码、编辑与保存全部在浏览器内完成，不会上传任何内容。',
    'zh-Hant': '本應用沒有後端。解碼、編輯與儲存全部在瀏覽器內完成，不會上傳任何內容。',
  },
  'about.feature.official': {
    en: 'Built for the official data', ja: '公式データにそのまま対応',
    'zh-Hans': '完整支持官方数据', 'zh-Hant': '完整支援官方資料',
  },
  'about.feature.officialBody': {
    en: 'Reads and rewrites the real datatable and fumen formats, and round-trips unedited data byte for byte.',
    ja: '実際のデータテーブルと譜面フォーマットを読み書きし、未編集のデータはバイト単位で元通りに書き戻します。',
    'zh-Hans': '直接读写真实的数据表与谱面格式，未编辑的数据可逐字节还原。',
    'zh-Hant': '直接讀寫真實的資料表與譜面格式，未編輯的資料可逐位元組還原。',
  },
  'about.feature.audio': {
    en: 'Full audio editing', ja: '音源編集にも対応',
    'zh-Hans': '完整的音频编辑', 'zh-Hant': '完整的音訊編輯',
  },
  'about.feature.audioBody': {
    en: 'Preview, replace, and convert song banks, and set the demo start against a live waveform.',
    ja: '楽曲バンクの試聴・差し替え・変換に加え、波形を見ながら試聴開始位置を設定できます。',
    'zh-Hans': '试听、替换与转换乐曲音源，并可对照实时波形设置试听起点。',
    'zh-Hant': '試聽、替換與轉換樂曲音源，並可對照即時波形設定試聽起點。',
  },
  'about.releaseTitle': {
    en: 'Version & changelog', ja: 'バージョンと更新履歴',
    'zh-Hans': '版本与更新日志', 'zh-Hant': '版本與更新日誌',
  },
  'about.currentVersion': {
    en: 'Current version', ja: '現在のバージョン',
    'zh-Hans': '当前版本', 'zh-Hant': '目前版本',
  },
  'about.changelogTitle': {
    en: 'Latest changes', ja: '最新の変更',
    'zh-Hans': '最新变更', 'zh-Hant': '最新變更',
  },
  'about.release.0_0_2.title': {
    en: 'Song-list controls', ja: '楽曲リストの操作',
    'zh-Hans': '歌曲列表控件', 'zh-Hant': '歌曲列表控制項',
  },
  'about.release.0_0_2.filterButton': {
    en: 'The song filter button is now a compact icon, so the filter and sort controls fit on one line in every language.',
    ja: '楽曲フィルターのボタンをアイコンのみにしました。すべての言語でフィルターと並べ替えの操作が 1 行に収まります。',
    'zh-Hans': '歌曲筛选按钮改为紧凑图标，筛选与排序控件在所有语言下均可显示在同一行。',
    'zh-Hant': '歌曲篩選按鈕改為精簡圖示，篩選與排序控制項在所有語言下均可顯示在同一行。',
  },
  'about.release.0_0_1.title': {
    en: 'Song-list sorting', ja: '楽曲リストの並べ替え',
    'zh-Hans': '歌曲列表排序', 'zh-Hant': '歌曲列表排序',
  },
  'about.release.0_0_1.songSort': {
    en: 'Clicking Song No. in the song sort controls now toggles between ascending and descending order.',
    ja: '楽曲の並べ替えで「楽曲番号」を繰り返しクリックすると、昇順と降順を切り替えられるようになりました。',
    'zh-Hans': '在歌曲排序控件中重复点击“歌曲编号”，现在可在升序和降序之间切换。',
    'zh-Hant': '在歌曲排序控制項中重複點擊「歌曲編號」，現在可在升序與降序之間切換。',
  },
  'about.release.0_0_0.title': {
    en: 'Development preview', ja: '開発プレビュー',
    'zh-Hans': '开发预览版', 'zh-Hant': '開發預覽版',
  },
  'about.release.0_0_0.about': {
    en: 'Added the current version and localized release notes to About.',
    ja: '「Bachi について」に現在のバージョンとローカライズされた更新履歴を追加しました。',
    'zh-Hans': '在“关于”中新增当前版本与本地化更新日志。',
    'zh-Hant': '在「關於」中新增目前版本與本地化更新日誌。',
  },
  'about.release.0_0_0.tja': {
    en: 'Improved TJA import with difficulty- and star-based soul-gauge estimates and complete Shin-uchi scoring.',
    ja: 'TJA インポートに、難易度と星数に基づく魂ゲージの推定と真打スコアの完全な取り込みを追加しました。',
    'zh-Hans': '改进 TJA 导入：可根据难度与星级估算魂槽，并完整导入真打计分。',
    'zh-Hant': '改進 TJA 匯入：可根據難度與星級估算魂槽，並完整匯入真打計分。',
  },
  'about.release.0_0_0.playhead': {
    en: 'Audio playback now keeps the active chart position in view.',
    ja: '音源の再生中、現在の譜面位置が表示範囲内に追従するようになりました。',
    'zh-Hans': '播放音频时，当前谱面位置现在会始终保持在视野内。',
    'zh-Hant': '播放音訊時，目前譜面位置現在會始終保持在視野內。',
  },
  'about.creditsTitle': {
    en: 'Acknowledgements', ja: '謝辞',
    'zh-Hans': '致谢', 'zh-Hant': '致謝',
  },
  'about.creditsLead': {
    en: 'Bachi stands on work generously shared by others:',
    ja: 'Bachi は、先人が公開してくださった成果の上に成り立っています:',
    'zh-Hans': 'Bachi 建立在他人慷慨分享的成果之上：',
    'zh-Hant': 'Bachi 建立在他人慷慨分享的成果之上：',
  },
  'about.credit.tja2fumen': {
    en: 'The TJA-to-fumen conversion model (MIT, © 2023 Vivaria).',
    ja: 'TJA から譜面への変換モデル（MIT、© 2023 Vivaria）。',
    'zh-Hans': 'TJA 转谱面的转换模型（MIT，© 2023 Vivaria）。',
    'zh-Hant': 'TJA 轉譜面的轉換模型（MIT，© 2023 Vivaria）。',
  },
  'about.credit.taikoSoundEditor': {
    en: 'The nus3bank template used when creating audio (MIT, © 2023 NotImplementedLife).',
    ja: '音源作成時に用いる nus3bank テンプレート（MIT、© 2023 NotImplementedLife）。',
    'zh-Hans': '创建音频时使用的 nus3bank 模板（MIT，© 2023 NotImplementedLife）。',
    'zh-Hant': '建立音訊時使用的 nus3bank 範本（MIT，© 2023 NotImplementedLife）。',
  },
  'about.credit.taikoLocalServer': {
    en: 'The server data formats Bachi targets, and the community documenting them.',
    ja: 'Bachi が対象とするサーバーデータ形式と、それを記録してきたコミュニティ。',
    'zh-Hans': 'Bachi 所面向的服务器数据格式，以及记录这些格式的社区。',
    'zh-Hant': 'Bachi 所面向的伺服器資料格式，以及記錄這些格式的社群。',
  },
  'about.dependenciesTitle': {
    en: 'Open-source dependencies', ja: 'オープンソース依存関係',
    'zh-Hans': '开源依赖', 'zh-Hant': '開源相依套件',
  },
  'about.licenseNote': {
    en: 'Bachi is MIT-licensed. Full third-party license texts ship with the source, in THIRD_PARTY_NOTICES.md and public/fonts/.',
    ja: 'Bachi は MIT ライセンスです。サードパーティのライセンス全文は、ソースの THIRD_PARTY_NOTICES.md と public/fonts/ に同梱しています。',
    'zh-Hans': 'Bachi 采用 MIT 许可证。第三方许可证全文随源码提供，位于 THIRD_PARTY_NOTICES.md 与 public/fonts/。',
    'zh-Hant': 'Bachi 採用 MIT 授權。第三方授權全文隨原始碼提供，位於 THIRD_PARTY_NOTICES.md 與 public/fonts/。',
  },
  'about.previous': { en: 'Previous page', ja: '前のページ', 'zh-Hans': '上一页', 'zh-Hant': '上一頁' },
  'about.next': { en: 'Next page', ja: '次のページ', 'zh-Hans': '下一页', 'zh-Hant': '下一頁' },
  'about.page': { en: 'Page {n}', ja: '{n} ページ目', 'zh-Hans': '第 {n} 页', 'zh-Hant': '第 {n} 頁' },
  'about.start': { en: 'Get started', ja: 'はじめる', 'zh-Hans': '开始使用', 'zh-Hant': '開始使用' },

  // Chart properties card (Inspector, no selection)
  'chartprops.branches': { en: 'Branches', ja: '譜面分岐', 'zh-Hans': '谱面分歧', 'zh-Hant': '譜面分歧' },
  'chartprops.soulGauge': { en: 'Soul gauge', ja: '魂ゲージ', 'zh-Hans': '魂槽', 'zh-Hant': '魂槽' },
  'chartprops.branchScoring': { en: 'Branch scoring', ja: '分岐スコア', 'zh-Hans': '分歧计分', 'zh-Hant': '分歧計分' },
  'chartprops.scoringTiming': { en: 'Scoring & timing', ja: '配点・判定', 'zh-Hans': '计分与判定', 'zh-Hant': '計分與判定' },
  'chartprops.branchedChart': { en: 'Branched chart', ja: '分岐譜面', 'zh-Hans': '分歧谱面', 'zh-Hant': '分歧譜面' },
  'chartprops.branchCounts': {
    en: 'Normal {normal} · Expert {expert} · Master {master}.',
    ja: '普通 {normal} · 玄人 {expert} · 達人 {master}。',
    'zh-Hans': '普通 {normal} · 玄人 {expert} · 达人 {master}。',
    'zh-Hant': '普通 {normal} · 玄人 {expert} · 達人 {master}。',
  },
  'chartprops.seedHint': {
    en: 'Seed the empty tracks, then edit each via the Branch focus bar.',
    ja: '空のトラックを生成してから、分岐フォーカスバーで個別に編集します。',
    'zh-Hans': '先生成空轨道，然后通过分歧聚焦栏分别编辑。',
    'zh-Hant': '先產生空軌道，然後透過分歧聚焦列分別編輯。',
  },
  'chartprops.flatChart': {
    en: 'Flat chart. Turn on to author Expert / Master tracks.',
    ja: 'フラット譜面です。オンにすると玄人・達人トラックを作成できます。',
    'zh-Hans': '无分歧谱面。开启后可编写玄人/达人轨道。',
    'zh-Hant': '無分歧譜面。開啟後可編寫玄人/達人軌道。',
  },
  'chartprops.flagOffWarning': {
    en: 'Expert/Master notes exist but the stored flag is off.',
    ja: '玄人・達人の音符は存在しますが、保存されたフラグはオフです。',
    'zh-Hans': '存在玄人/达人音符，但存储的标志为关闭。',
    'zh-Hant': '存在玄人/達人音符，但儲存的標誌為關閉。',
  },
  'chartprops.seedButton': {
    en: 'Seed Expert & Master from Normal',
    ja: '普通から玄人・達人を生成',
    'zh-Hans': '从普通生成玄人和达人',
    'zh-Hant': '從普通產生玄人與達人',
  },
  'chartprops.gaugeMax': { en: 'Gauge max', ja: 'ゲージ最大', 'zh-Hans': '血槽上限', 'zh-Hant': '血槽上限' },
  'chartprops.clearAt': { en: 'Clear at', ja: 'クリア地点', 'zh-Hans': '通关线', 'zh-Hant': '通關線' },
  'chartprops.gainGood': { en: 'Gain · Good', ja: '獲得・良', 'zh-Hans': '增加·良', 'zh-Hant': '增加·良' },
  'chartprops.gainOk': { en: 'Gain · OK', ja: '獲得・可', 'zh-Hans': '增加·可', 'zh-Hant': '增加·可' },
  'chartprops.lossBad': { en: 'Loss · Bad', ja: '減少・不可', 'zh-Hans': '减少·不可', 'zh-Hant': '減少·不可' },
  'chartprops.ratios': { en: 'Ratios', ja: '比率', 'zh-Hans': '比率', 'zh-Hant': '比率' },
  'chartprops.pointsPerHit': { en: 'Points per hit', ja: 'ヒットあたりの点数', 'zh-Hans': '每次命中得分', 'zh-Hant': '每次命中得分' },
  'chartprops.ptsGood': { en: 'Good', ja: '良', 'zh-Hans': '良', 'zh-Hant': '良' },
  'chartprops.ptsOk': { en: 'OK', ja: '可', 'zh-Hans': '可', 'zh-Hant': '可' },
  'chartprops.ptsBad': { en: 'Bad', ja: '不可', 'zh-Hans': '不可', 'zh-Hant': '不可' },
  'chartprops.ptsDrumroll': { en: 'Drumroll', ja: '連打', 'zh-Hans': '连打', 'zh-Hant': '連打' },
  'chartprops.ptsGoodBig': { en: 'Good · big', ja: '良・大', 'zh-Hans': '良·大', 'zh-Hant': '良·大' },
  'chartprops.ptsOkBig': { en: 'OK · big', ja: '可・大', 'zh-Hans': '可·大', 'zh-Hant': '可·大' },
  'chartprops.ptsDrumrollBig': { en: 'Drumroll · big', ja: '連打・大', 'zh-Hans': '连打·大', 'zh-Hant': '連打·大' },
  'chartprops.ptsBalloon': { en: 'Balloon', ja: '風船', 'zh-Hans': '气球', 'zh-Hant': '氣球' },
  'chartprops.ptsKusudama': { en: 'Kusudama', ja: 'くす玉', 'zh-Hans': '彩球', 'zh-Hant': '彩球' },
  'chartprops.ptsReserved': { en: 'Reserved', ja: '予約', 'zh-Hans': '保留', 'zh-Hant': '保留' },
  'chartprops.timingWindows': { en: 'Timing windows', ja: '判定枠', 'zh-Hans': '判定窗口', 'zh-Hant': '判定窗口' },
  'chartprops.measures': { en: 'Measures', ja: '小節数', 'zh-Hans': '小节数', 'zh-Hant': '小節數' },
  'chartprops.byDifficulty': { en: 'by difficulty', ja: '難易度で決定', 'zh-Hans': '由难度决定', 'zh-Hant': '由難度決定' },
  'chartprops.calculated': { en: 'calculated', ja: '計算値', 'zh-Hans': '计算值', 'zh-Hant': '計算值' },
  'chartprops.scoreCeiling': { en: 'Score ceiling', ja: '理論値', 'zh-Hans': '理论值', 'zh-Hant': '理論值' },
  'chartprops.scoreCeilingSub': { en: 'legacy scoring · calculated', ja: '旧配点 · 計算値', 'zh-Hans': '旧计分 · 计算值', 'zh-Hant': '舊計分 · 計算值' },
  'chartprops.baseScore': { en: 'Base score', ja: '初項', 'zh-Hans': '初项', 'zh-Hant': '初項' },
  'chartprops.scoreStep': { en: 'Score step', ja: '公差', 'zh-Hans': '公差', 'zh-Hant': '公差' },
  'chartprops.chartWide': { en: 'chart-wide', ja: 'チャート共通', 'zh-Hans': '全谱统一', 'zh-Hant': '全譜統一' },
  'chartprops.perTenCombo': { en: 'per 10 combo', ja: '10コンボ毎', 'zh-Hans': '每10连击', 'zh-Hant': '每10連擊' },

  // Inspector
  'inspector.title': { en: 'INSPECTOR', ja: 'インスペクター', 'zh-Hans': '检查器', 'zh-Hant': '檢視器' },
  'inspector.diffChart': { en: '{diff} chart', ja: '{diff} 譜面', 'zh-Hans': '{diff} 谱面', 'zh-Hant': '{diff} 譜面' },
  'inspector.noChartLoaded': {
    en: 'No chart loaded', ja: '譜面が読み込まれていません',
    'zh-Hans': '未加载谱面', 'zh-Hant': '未載入譜面',
  },
  'inspector.notBranchPoint': {
    en: 'Not a branch point. Add thresholds to gate the Expert / Master tracks here.',
    ja: '分岐点ではありません。しきい値を追加して、ここで玄人・達人トラックへの分岐を設定します。',
    'zh-Hans': '非分歧点。在此添加阈值以控制进入玄人/达人轨道。',
    'zh-Hant': '非分歧點。在此新增門檻以控制進入玄人/達人軌道。',
  },
  'inspector.makeBranchPoint': {
    en: 'Make branch point', ja: '分岐点にする',
    'zh-Hans': '设为分歧点', 'zh-Hant': '設為分歧點',
  },
  'inspector.toExpert': { en: '→ Expert', ja: '→ 玄人', 'zh-Hans': '→ 玄人', 'zh-Hant': '→ 玄人' },
  'inspector.toMaster': { en: '→ Master', ja: '→ 達人', 'zh-Hans': '→ 达人', 'zh-Hant': '→ 達人' },
  'inspector.fromBranch': { en: 'From {branch}', ja: '{branch}から', 'zh-Hans': '来自{branch}', 'zh-Hant': '來自{branch}' },
  'inspector.branchThresholdNote': {
    en: '-1 = no requirement · higher value = harder to reach that track',
    ja: '-1 = 条件なし · 値が大きいほどそのトラックに到達しにくい',
    'zh-Hans': '-1 = 无要求 · 数值越大越难进入该轨道',
    'zh-Hant': '-1 = 無要求 · 數值越大越難進入該軌道',
  },
  'inspector.clearBranchPoint': {
    en: 'Clear branch point', ja: '分岐点を解除',
    'zh-Hans': '清除分歧点', 'zh-Hant': '清除分歧點',
  },
  'inspector.stave': { en: '{branch} stave', ja: '{branch}譜表', 'zh-Hans': '{branch}谱表', 'zh-Hant': '{branch}譜表' },
  'inspector.allBranches': { en: 'All branches', ja: 'すべての分岐', 'zh-Hans': '所有分歧', 'zh-Hant': '所有分歧' },
  'inspector.timingLast': {
    en: 'Last measure — duration is the 4-beat fallback (no following offset).',
    ja: '最終小節 — 長さは 4 拍のフォールバックです（後続オフセットなし）。',
    'zh-Hans': '最后一小节——时长为 4 拍的回退值（无后续偏移）。',
    'zh-Hant': '最後一小節——時長為 4 拍的回退值（無後續偏移）。',
  },
  'inspector.timingFallback': {
    en: 'Duration is the 4-beat fallback (offset column unusable).',
    ja: '長さは 4 拍のフォールバックです（オフセット列が使用不可）。',
    'zh-Hans': '时长为 4 拍的回退值（偏移列不可用）。',
    'zh-Hant': '時長為 4 拍的回退值（偏移欄不可用）。',
  },
  'inspector.scrollLabel': { en: '{branch} scroll', ja: '{branch}スクロール', 'zh-Hans': '{branch}卷动', 'zh-Hant': '{branch}捲動' },
  'inspector.scrollSpeed': { en: 'Scroll speed', ja: 'スクロール速度', 'zh-Hans': '卷动速度', 'zh-Hant': '捲動速度' },
  'inspector.measureHeading': {
    en: 'Measure {n} · {scope}', ja: '小節 {n} · {scope}',
    'zh-Hans': '小节 {n} · {scope}', 'zh-Hant': '小節 {n} · {scope}',
  },
  'inspector.measureSubhead': {
    en: 'Start {start} · {perBeat} ms / beat', ja: '開始 {start} · {perBeat} ms/拍',
    'zh-Hans': '起始 {start} · {perBeat} ms/拍', 'zh-Hant': '起始 {start} · {perBeat} ms/拍',
  },
  'inspector.timing': { en: 'Timing', ja: 'タイミング', 'zh-Hans': '计时', 'zh-Hant': '計時' },
  'inspector.length': { en: 'Length', ja: '長さ', 'zh-Hans': '长度', 'zh-Hant': '長度' },
  'inspector.duration': { en: 'Duration', ja: '継続時間', 'zh-Hans': '时长', 'zh-Hant': '時長' },
  'inspector.offsetStored': {
    en: 'Offset (stored)', ja: 'オフセット（保存値）',
    'zh-Hans': '偏移（存储值）', 'zh-Hant': '偏移（儲存值）',
  },
  'inspector.bpmScroll': { en: 'BPM & scroll', ja: 'BPM・スクロール', 'zh-Hans': 'BPM 与卷动', 'zh-Hant': 'BPM 與捲動' },
  'inspector.inheritedNote': {
    en: 'Dashed = inherited from measure {n}. Click a value to override.',
    ja: '破線 = 小節 {n} から継承。値をクリックして上書きします。',
    'zh-Hans': '虚线 = 继承自小节 {n}。点击数值以覆盖。',
    'zh-Hant': '虛線 = 繼承自小節 {n}。點擊數值以覆蓋。',
  },
  'inspector.baseValuesNote': {
    en: 'First measure values are the chart base values.',
    ja: '最初の小節の値は譜面の基準値です。',
    'zh-Hans': '第一小节的值为谱面基准值。',
    'zh-Hant': '第一小節的值為譜面基準值。',
  },
  'inspector.flags': { en: 'Flags', ja: 'フラグ', 'zh-Hans': '标志', 'zh-Hant': '標誌' },
  'inspector.barline': { en: 'Barline', ja: '小節線', 'zh-Hans': '小节线', 'zh-Hant': '小節線' },
  'inspector.branchPoint': { en: 'Branch point', ja: '分岐点', 'zh-Hans': '分歧点', 'zh-Hant': '分歧點' },
  'inspector.lengthBeats': { en: 'Length (beats)', ja: '長さ（拍）', 'zh-Hans': '长度（拍）', 'zh-Hant': '長度（拍）' },
  'inspector.lengthMs': { en: 'Length (ms)', ja: '長さ（ms）', 'zh-Hans': '长度（ms）', 'zh-Hant': '長度（ms）' },
  'inspector.linkTitle': {
    en: 'Beats and milliseconds are two units for the same measure length — editing one rescales the other.',
    ja: '拍とミリ秒は同じ小節長の 2 つの単位です。一方を編集するともう一方が再計算されます。',
    'zh-Hans': '拍与毫秒是同一小节长度的两种单位——编辑其中一个会重新计算另一个。',
    'zh-Hant': '拍與毫秒是同一小節長度的兩種單位——編輯其中一個會重新計算另一個。',
  },
  'inspector.presetTitle.one': {
    en: '{label} beat ({ms} ms)', ja: '{label} 拍（{ms} ms）',
    'zh-Hans': '{label} 拍（{ms} ms）', 'zh-Hant': '{label} 拍（{ms} ms）',
  },
  'inspector.presetTitle.other': {
    en: '{label} beats ({ms} ms)', ja: '{label} 拍（{ms} ms）',
    'zh-Hans': '{label} 拍（{ms} ms）', 'zh-Hant': '{label} 拍（{ms} ms）',
  },
  'inspector.nextBoundary': {
    en: '→ next boundary at {ms}', ja: '→ 次の境界: {ms}',
    'zh-Hans': '→ 下一边界：{ms}', 'zh-Hant': '→ 下一邊界：{ms}',
  },
  'inspector.overflowWarn.one': {
    en: '{n} note would fall outside the shorter measure.',
    ja: '{n} 個の音符が短くなった小節の外にはみ出します。',
    'zh-Hans': '{n} 个音符将超出缩短后的小节。',
    'zh-Hant': '{n} 個音符將超出縮短後的小節。',
  },
  'inspector.overflowWarn.other': {
    en: '{n} notes would fall outside the shorter measure.',
    ja: '{n} 個の音符が短くなった小節の外にはみ出します。',
    'zh-Hans': '{n} 个音符将超出缩短后的小节。',
    'zh-Hant': '{n} 個音符將超出縮短後的小節。',
  },
  'inspector.scaleTitle': {
    en: 'Keep every note, scaling their positions into the shorter measure',
    ja: 'すべての音符を保持し、位置を短くなった小節に合わせて縮小します',
    'zh-Hans': '保留所有音符，将其位置缩放到缩短后的小节内',
    'zh-Hant': '保留所有音符，將其位置縮放到縮短後的小節內',
  },
  'inspector.scale': { en: 'Scale', ja: '縮小', 'zh-Hans': '缩放', 'zh-Hant': '縮放' },
  'inspector.truncateTitle': {
    en: 'Delete the notes that fall outside the shorter measure',
    ja: '短くなった小節の外にはみ出す音符を削除します',
    'zh-Hans': '删除超出缩短后小节的音符',
    'zh-Hant': '刪除超出縮短後小節的音符',
  },
  'inspector.truncate': { en: 'Truncate', ja: '切り詰め', 'zh-Hans': '截断', 'zh-Hant': '截斷' },
  'inspector.inheritedTitle': {
    en: 'Inherited from the previous measure — edit to override',
    ja: '前の小節から継承 — 編集して上書き',
    'zh-Hans': '继承自上一小节——编辑以覆盖',
    'zh-Hant': '繼承自上一小節——編輯以覆蓋',
  },
  'inspector.resetToInherited': {
    en: 'Reset to inherited', ja: '継承値にリセット',
    'zh-Hans': '重置为继承值', 'zh-Hant': '重置為繼承值',
  },
  'inspector.noNoteSelected': {
    en: 'No note selected', ja: '音符が選択されていません',
    'zh-Hans': '未选择音符', 'zh-Hant': '未選擇音符',
  },
  'inspector.noteLine': {
    en: 'Measure {n} · beat {beat} · {hex}', ja: '小節 {n} · 拍 {beat} · {hex}',
    'zh-Hans': '小节 {n} · 拍 {beat} · {hex}', 'zh-Hant': '小節 {n} · 拍 {beat} · {hex}',
  },
  'inspector.selection': { en: 'Selection', ja: '選択', 'zh-Hans': '选择', 'zh-Hant': '選擇' },
  'inspector.notesSelected': {
    en: '{n} notes selected', ja: '{n} 個の音符を選択中',
    'zh-Hans': '已选择 {n} 个音符', 'zh-Hant': '已選擇 {n} 個音符',
  },
  'inspector.marqueeHint': {
    en: 'Marquee selection · ⌫ or Delete to remove',
    ja: 'マーキー選択 · ⌫ または Delete で削除',
    'zh-Hans': '框选 · ⌫ 或 Delete 删除',
    'zh-Hant': '框選 · ⌫ 或 Delete 刪除',
  },
  'inspector.deleteNotes': {
    en: 'Delete {n} notes', ja: '{n} 個の音符を削除',
    'zh-Hans': '删除 {n} 个音符', 'zh-Hant': '刪除 {n} 個音符',
  },
  'inspector.note': { en: 'Note', ja: '音符', 'zh-Hans': '音符', 'zh-Hant': '音符' },
  'inspector.noteBranchIndex': {
    en: '{branch} branch · index {n}', ja: '{branch}分岐 · インデックス {n}',
    'zh-Hans': '{branch}分歧 · 索引 {n}', 'zh-Hant': '{branch}分歧 · 索引 {n}',
  },
  'inspector.type': { en: 'Type', ja: '種類', 'zh-Hans': '类型', 'zh-Hant': '類型' },
  'inspector.notePreserved': {
    en: '{label} (preserved)', ja: '{label}（保持）',
    'zh-Hans': '{label}（保留）', 'zh-Hant': '{label}（保留）',
  },
  'inspector.positionMs': { en: 'Position ms', ja: '位置 ms', 'zh-Hans': '位置 ms', 'zh-Hant': '位置 ms' },
  'inspector.durationMs': { en: 'Duration ms', ja: '継続時間 ms', 'zh-Hans': '时长 ms', 'zh-Hant': '時長 ms' },
  'inspector.balloonCount': { en: 'Balloon count', ja: '風船打数', 'zh-Hans': '气球次数', 'zh-Hant': '氣球次數' },
  'inspector.deleteNote': { en: 'Delete note', ja: '音符を削除', 'zh-Hans': '删除音符', 'zh-Hant': '刪除音符' },
  'inspector.chartStats': {
    en: '{diff} · chart stats', ja: '{diff} · 譜面統計',
    'zh-Hans': '{diff} · 谱面统计', 'zh-Hant': '{diff} · 譜面統計',
  },
  'inspector.totalNotes': { en: 'Total notes', ja: '総音符数', 'zh-Hans': '音符总数', 'zh-Hant': '音符總數' },
  'inspector.drumrolls': { en: 'Drumrolls', ja: '連打', 'zh-Hans': '连打', 'zh-Hant': '連打' },
  'inspector.balloons': { en: 'Balloons', ja: '風船', 'zh-Hans': '气球', 'zh-Hant': '氣球' },

  // Song list
  'songlist.filter.edited': { en: 'Edited', ja: '編集済み', 'zh-Hans': '已编辑', 'zh-Hant': '已編輯' },
  'songlist.filter.noaudio': { en: 'No Audio', ja: '音声なし', 'zh-Hans': '无音频', 'zh-Hant': '無音訊' },
  'songlist.filter.notinorder': {
    en: 'Not in Song Order', ja: '曲順に未登録',
    'zh-Hans': '不在乐曲顺序中', 'zh-Hant': '不在樂曲順序中',
  },
  'songlist.sortUniqueIdTitle': {
    en: 'Sort by ascending Song No. (musicinfo.uniqueId)',
    ja: '楽曲番号の昇順で並べ替え（musicinfo.uniqueId）',
    'zh-Hans': '按乐曲编号升序排序（musicinfo.uniqueId）',
    'zh-Hant': '按樂曲編號升序排序（musicinfo.uniqueId）',
  },
  'songlist.sortUniqueIdDescTitle': {
    en: 'Sort by descending Song No. (musicinfo.uniqueId)',
    ja: '楽曲番号の降順で並べ替え（musicinfo.uniqueId）',
    'zh-Hans': '按乐曲编号降序排序（musicinfo.uniqueId）',
    'zh-Hant': '按樂曲編號降序排序（musicinfo.uniqueId）',
  },
  'songlist.sortGenreTitle': {
    en: 'Sort by in-game genre order, then ascending Song No.',
    ja: 'ゲーム内のジャンル順、次に楽曲番号の昇順で並べ替え',
    'zh-Hans': '按游戏内类别顺序，然后按乐曲编号升序排序',
    'zh-Hant': '按遊戲內類別順序，然後按樂曲編號升序排序',
  },
  'songlist.title': { en: 'Song List', ja: '楽曲リスト', 'zh-Hans': '乐曲列表', 'zh-Hant': '樂曲列表' },
  'songlist.addTitle': { en: 'Add a new song', ja: '新しい楽曲を追加', 'zh-Hans': '添加新歌曲', 'zh-Hant': '新增新歌曲' },
  'songlist.removeFilter': {
    en: 'Remove {label} filter', ja: '{label}フィルターを解除',
    'zh-Hans': '移除{label}筛选', 'zh-Hant': '移除{label}篩選',
  },
  'songlist.searchPlaceholder': {
    en: 'Search title, Song ID, Song No.…',
    ja: 'タイトル・楽曲ID・楽曲番号で検索…',
    'zh-Hans': '搜索标题、歌曲 ID、歌曲编号…',
    'zh-Hant': '搜尋標題、歌曲 ID、歌曲編號…',
  },
  'songlist.searchAria': { en: 'Search songs', ja: '楽曲を検索', 'zh-Hans': '搜索歌曲', 'zh-Hant': '搜尋歌曲' },
  'songlist.clearSearch': { en: 'Clear search', ja: '検索をクリア', 'zh-Hans': '清除搜索', 'zh-Hant': '清除搜尋' },
  'songlist.chooseFilters': {
    en: 'Choose song filters', ja: '楽曲フィルターを選択',
    'zh-Hans': '选择歌曲筛选', 'zh-Hant': '選擇歌曲篩選',
  },
  'songlist.songFilters': { en: 'Song filters', ja: '楽曲フィルター', 'zh-Hans': '歌曲筛选', 'zh-Hant': '歌曲篩選' },
  'songlist.sorting': { en: 'Song sorting', ja: '楽曲の並べ替え', 'zh-Hans': '歌曲排序', 'zh-Hant': '歌曲排序' },
  'songlist.sort': { en: 'Sort', ja: '並べ替え', 'zh-Hans': '排序', 'zh-Hant': '排序' },
  'songlist.healthNoChart': {
    en: 'Incomplete — no chart', ja: '未完成 — 譜面なし',
    'zh-Hans': '不完整——无谱面', 'zh-Hant': '不完整——無譜面',
  },
  'songlist.healthNoAudio': { en: 'Missing audio', ja: '音声なし', 'zh-Hans': '缺少音频', 'zh-Hant': '缺少音訊' },
  'songlist.healthReady': { en: 'Game-ready', ja: 'プレイ可能', 'zh-Hans': '可游玩', 'zh-Hant': '可遊玩' },
  'songlist.emptySearch': {
    en: 'No songs match "{search}".', ja: '「{search}」に一致する楽曲がありません。',
    'zh-Hans': '没有与“{search}”匹配的歌曲。', 'zh-Hant': '沒有與「{search}」相符的歌曲。',
  },
  'songlist.emptyFilters': {
    en: 'No songs match the selected filters.',
    ja: '選択したフィルターに一致する楽曲がありません。',
    'zh-Hans': '没有与所选筛选匹配的歌曲。',
    'zh-Hant': '沒有與所選篩選相符的歌曲。',
  },
  'songlist.emptyNone': {
    en: 'No songs available.', ja: '利用可能な楽曲がありません。',
    'zh-Hans': '没有可用的歌曲。', 'zh-Hant': '沒有可用的歌曲。',
  },
  'songlist.emptyNoProject': {
    en: 'No project open. Choose a project folder in Settings.',
    ja: 'プロジェクトが開かれていません。設定でプロジェクトフォルダーを選択してください。',
    'zh-Hans': '未打开项目。请在设置中选择项目文件夹。',
    'zh-Hant': '未開啟專案。請在設定中選擇專案資料夾。',
  },

  // Add song dialog
  'addsong.addSong': { en: 'Add song', ja: '楽曲を追加', 'zh-Hans': '添加歌曲', 'zh-Hant': '新增歌曲' },
  'addsong.intro': {
    en: 'Song No., Song ID, and canonical genre cannot be changed after creation. The required initial title remains editable in Metadata. No Music Order placement is created; ordering is managed independently in the Music Order tab.',
    ja: '楽曲番号・楽曲ID・ジャンルは作成後に変更できません。必須の初期タイトルはメタデータで編集できます。曲順への配置は作成されません。並び順は「曲順」タブで個別に管理します。',
    'zh-Hans': '歌曲编号、歌曲 ID 和类别在创建后无法更改。必填的初始标题可在元数据中编辑。不会创建乐曲顺序位置；顺序在乐曲顺序标签页中单独管理。',
    'zh-Hant': '歌曲編號、歌曲 ID 和類別在建立後無法變更。必填的初始標題可在後設資料中編輯。不會建立樂曲順序位置；順序在樂曲順序分頁中另外管理。',
  },
  'addsong.errNonNeg': {
    en: 'Song No. must be a non-negative whole number.',
    ja: '楽曲番号は 0 以上の整数である必要があります。',
    'zh-Hans': '歌曲编号必须为非负整数。',
    'zh-Hant': '歌曲編號必須為非負整數。',
  },
  'addsong.errRange': {
    en: 'Song No. must be between 0 and 2,147,483,647.',
    ja: '楽曲番号は 0〜2,147,483,647 の範囲である必要があります。',
    'zh-Hans': '歌曲编号必须介于 0 和 2,147,483,647 之间。',
    'zh-Hant': '歌曲編號必須介於 0 和 2,147,483,647 之間。',
  },
  'addsong.errSongNoExists': {
    en: 'Song No. {n} already exists.', ja: '楽曲番号 {n} は既に存在します。',
    'zh-Hans': '歌曲编号 {n} 已存在。', 'zh-Hant': '歌曲編號 {n} 已存在。',
  },
  'addsong.errIdChars': {
    en: 'Use lowercase letters, digits and underscores only.',
    ja: '英小文字・数字・アンダースコアのみ使用できます。',
    'zh-Hans': '仅可使用小写字母、数字和下划线。',
    'zh-Hant': '僅可使用小寫字母、數字和底線。',
  },
  'addsong.errIdExists': {
    en: 'A song with Song ID "{id}" already exists.',
    ja: '楽曲ID「{id}」の楽曲は既に存在します。',
    'zh-Hans': '已存在歌曲 ID 为“{id}”的歌曲。',
    'zh-Hant': '已存在歌曲 ID 為「{id}」的歌曲。',
  },
  'addsong.eg': { en: 'e.g. {n}', ja: '例: {n}', 'zh-Hans': '例如 {n}', 'zh-Hant': '例如 {n}' },
  'addsong.selectGenre': { en: 'Select genre…', ja: 'ジャンルを選択…', 'zh-Hans': '选择类别…', 'zh-Hant': '選擇類別…' },
  'addsong.titleAllLocales': {
    en: 'Title (all locales)', ja: 'タイトル（全言語）',
    'zh-Hans': '标题（所有语言）', 'zh-Hant': '標題（所有語言）',
  },
  'addsong.requiredTitle': { en: 'Required title', ja: '必須のタイトル', 'zh-Hans': '必填标题', 'zh-Hant': '必填標題' },
  'addsong.idNote': {
    en: 'The Song ID becomes the fumen folder and default sound-bank name: {folder} · {bank}.',
    ja: '楽曲IDは譜面フォルダーと既定のサウンドバンク名になります：{folder} · {bank}。',
    'zh-Hans': '歌曲 ID 将作为谱面文件夹和默认音源库名称：{folder} · {bank}。',
    'zh-Hant': '歌曲 ID 將作為譜面資料夾和預設音源庫名稱：{folder} · {bank}。',
  },

  // Delete song dialog
  'deletesong.title': { en: 'Delete song', ja: '楽曲を削除', 'zh-Hans': '删除歌曲', 'zh-Hant': '刪除歌曲' },
  'deletesong.pill': {
    en: 'Song ID {id} · Song No. {no}', ja: '楽曲ID {id} · 楽曲番号 {no}',
    'zh-Hans': '歌曲 ID {id} · 歌曲编号 {no}', 'zh-Hant': '歌曲 ID {id} · 歌曲編號 {no}',
  },
  'deletesong.confirm': {
    en: 'Remove {title} from musicinfo, music_order and wordlist?',
    ja: '{title} を musicinfo・music_order・wordlist から削除しますか？',
    'zh-Hans': '从 musicinfo、music_order 和 wordlist 中移除 {title}？',
    'zh-Hant': '從 musicinfo、music_order 和 wordlist 中移除 {title}？',
  },
  'deletesong.filesBoth': {
    en: 'On save, its chart folder and sound file will be permanently removed from disk.',
    ja: '保存時に、譜面フォルダーとサウンドファイルがディスクから完全に削除されます。',
    'zh-Hans': '保存时，其谱面文件夹和音频文件将从磁盘中永久删除。',
    'zh-Hant': '儲存時，其譜面資料夾和音訊檔案將從磁碟中永久刪除。',
  },
  'deletesong.filesChart': {
    en: 'On save, its chart folder will be permanently removed from disk.',
    ja: '保存時に、譜面フォルダーがディスクから完全に削除されます。',
    'zh-Hans': '保存时，其谱面文件夹将从磁盘中永久删除。',
    'zh-Hant': '儲存時，其譜面資料夾將從磁碟中永久刪除。',
  },
  'deletesong.filesSound': {
    en: 'On save, its sound file will be permanently removed from disk.',
    ja: '保存時に、サウンドファイルがディスクから完全に削除されます。',
    'zh-Hans': '保存时，其音频文件将从磁盘中永久删除。',
    'zh-Hant': '儲存時，其音訊檔案將從磁碟中永久刪除。',
  },
  'deletesong.filesNone': {
    en: 'It has no chart or sound files on disk, so only the datatable entries are removed.',
    ja: 'ディスク上に譜面・サウンドファイルがないため、データテーブルのエントリのみが削除されます。',
    'zh-Hans': '磁盘上没有谱面或音频文件，因此仅删除数据表条目。',
    'zh-Hant': '磁碟上沒有譜面或音訊檔案，因此僅刪除資料表條目。',
  },
  'deletesong.undoNote': {
    en: 'You can undo this until you save.', ja: '保存するまで元に戻せます。',
    'zh-Hans': '在保存之前可以撤销。', 'zh-Hant': '在儲存之前可以復原。',
  },

  // Export server bundle dialog
  'export.title': {
    en: 'Export server bundle', ja: 'サーバーバンドルをエクスポート',
    'zh-Hans': '导出服务器捆绑包', 'zh-Hant': '匯出伺服器套件',
  },
  'export.intro': {
    en: 'Builds a zip for {path}. Copy the contents there and restart the server.',
    ja: '{path} 用の zip を作成します。中身をそこにコピーし、サーバーを再起動してください。',
    'zh-Hans': '为 {path} 构建一个 zip。将其内容复制到该位置并重启服务器。',
    'zh-Hant': '為 {path} 建立一個 zip。將其內容複製到該位置並重新啟動伺服器。',
  },
  'export.dirtyWarn.one': {
    en: '{n} unsaved edit will be included from the current Bachi draft. Save first if the game files on disk must match this bundle.',
    ja: '{n} 件の未保存の編集が現在の Bachi ドラフトから含まれます。ディスク上のゲームファイルとこのバンドルを一致させるには、先に保存してください。',
    'zh-Hans': '当前 Bachi 草稿中有 {n} 项未保存的编辑将被包含。如果磁盘上的游戏文件必须与此捆绑包一致，请先保存。',
    'zh-Hant': '目前 Bachi 草稿中有 {n} 項未儲存的編輯將被包含。如果磁碟上的遊戲檔案必須與此套件一致，請先儲存。',
  },
  'export.dirtyWarn.other': {
    en: '{n} unsaved edits will be included from the current Bachi draft. Save first if the game files on disk must match this bundle.',
    ja: '{n} 件の未保存の編集が現在の Bachi ドラフトから含まれます。ディスク上のゲームファイルとこのバンドルを一致させるには、先に保存してください。',
    'zh-Hans': '当前 Bachi 草稿中有 {n} 项未保存的编辑将被包含。如果磁盘上的游戏文件必须与此捆绑包一致，请先保存。',
    'zh-Hant': '目前 Bachi 草稿中有 {n} 項未儲存的編輯將被包含。如果磁碟上的遊戲檔案必須與此套件一致，請先儲存。',
  },
  'export.bundleContents': { en: 'Bundle contents', ja: 'バンドルの内容', 'zh-Hans': '捆绑包内容', 'zh-Hant': '套件內容' },
  'export.datatableSum': {
    en: 'Current decoded datatable draft, sealed for game/server use.',
    ja: '現在のデコード済みデータテーブルのドラフト。ゲーム／サーバー用に封をしています。',
    'zh-Hans': '当前解码的数据表草稿，已封装以供游戏/服务器使用。',
    'zh-Hant': '目前解碼的資料表草稿，已封裝以供遊戲/伺服器使用。',
  },
  'export.neiroSum': {
    en: 'Copied through when the project has a readable neiro datatable.',
    ja: 'プロジェクトに読み取り可能な neiro データテーブルがある場合にコピーされます。',
    'zh-Hans': '当项目具有可读的 neiro 数据表时复制。',
    'zh-Hant': '當專案具有可讀的 neiro 資料表時複製。',
  },
  'export.readmeSum': {
    en: 'Target path and restart reminder.', ja: 'コピー先のパスと再起動のリマインダー。',
    'zh-Hans': '目标路径和重启提醒。', 'zh-Hant': '目標路徑和重新啟動提醒。',
  },
  'export.created': { en: 'Created', ja: '作成済み', 'zh-Hans': '已创建', 'zh-Hant': '已建立' },
  'export.downloaded': {
    en: 'Downloaded {filename} with {n} files.', ja: '{filename} をダウンロードしました（{n} ファイル）。',
    'zh-Hans': '已下载 {filename}（{n} 个文件）。', 'zh-Hant': '已下載 {filename}（{n} 個檔案）。',
  },
  'export.error': { en: 'Error', ja: 'エラー', 'zh-Hans': '错误', 'zh-Hant': '錯誤' },
  'export.statusDownloaded': {
    en: 'bundle downloaded', ja: 'バンドルをダウンロード済み',
    'zh-Hans': '捆绑包已下载', 'zh-Hant': '套件已下載',
  },
  'export.statusFailed': { en: '✗ export failed', ja: '✗ エクスポート失敗', 'zh-Hans': '✗ 导出失败', 'zh-Hant': '✗ 匯出失敗' },
  'export.statusReady': { en: 'datatables ready', ja: 'データテーブル準備完了', 'zh-Hans': '数据表就绪', 'zh-Hant': '資料表就緒' },
  'export.building': { en: 'Building…', ja: '作成中…', 'zh-Hans': '构建中…', 'zh-Hant': '建立中…' },
  'export.downloadAgain': { en: 'Download again', ja: '再ダウンロード', 'zh-Hans': '再次下载', 'zh-Hant': '再次下載' },
  'export.buildZip': { en: 'Build zip', ja: 'zip を作成', 'zh-Hans': '构建 zip', 'zh-Hant': '建立 zip' },

  // Save dialog
  'savedialog.newChart': { en: 'new chart file', ja: '新規譜面ファイル', 'zh-Hans': '新谱面文件', 'zh-Hant': '新譜面檔案' },
  'savedialog.removeChart': { en: 'remove chart file', ja: '譜面ファイルを削除', 'zh-Hans': '移除谱面文件', 'zh-Hant': '移除譜面檔案' },
  'savedialog.more': { en: '+{n} more…', ja: 'ほか {n} 件…', 'zh-Hans': '还有 {n} 项…', 'zh-Hant': '還有 {n} 項…' },
  'savedialog.selfCheckFailedFor': {
    en: 'Codec self-check failed for {file}; no files will be written.',
    ja: 'コーデックのセルフチェックが {file} で失敗しました。ファイルは書き込まれません。',
    'zh-Hans': '{file} 的编解码自检失败；不会写入任何文件。',
    'zh-Hant': '{file} 的編解碼自檢失敗；不會寫入任何檔案。',
  },
  'savedialog.selfCheckNone': {
    en: 'No edited charts need a codec self-check.',
    ja: '編集された譜面がないため、コーデックのセルフチェックは不要です。',
    'zh-Hans': '没有已编辑的谱面需要编解码自检。',
    'zh-Hant': '沒有已編輯的譜面需要編解碼自檢。',
  },
  'savedialog.selfCheckPassed': {
    en: 'Codec self-check passed on all edited charts.',
    ja: 'すべての編集済み譜面でコーデックのセルフチェックに合格しました。',
    'zh-Hans': '所有已编辑的谱面均通过编解码自检。',
    'zh-Hant': '所有已編輯的譜面均通過編解碼自檢。',
  },
  'savedialog.selfCheckFailed': {
    en: 'Codec self-check failed on an edited chart.',
    ja: '編集済み譜面でコーデックのセルフチェックに失敗しました。',
    'zh-Hans': '某个已编辑的谱面未通过编解码自检。',
    'zh-Hant': '某個已編輯的譜面未通過編解碼自檢。',
  },
  'savedialog.titleSongs': { en: 'Save song data', ja: '楽曲データを保存', 'zh-Hans': '保存乐曲数据', 'zh-Hant': '儲存樂曲資料' },
  'savedialog.titleOrder': { en: 'Save music order', ja: '曲順を保存', 'zh-Hans': '保存乐曲顺序', 'zh-Hant': '儲存樂曲順序' },
  'savedialog.pill.one': {
    en: '{files} file · {changed} changed', ja: '{files} ファイル · {changed} 件変更',
    'zh-Hans': '{files} 个文件 · {changed} 项更改', 'zh-Hant': '{files} 個檔案 · {changed} 項變更',
  },
  'savedialog.pill.other': {
    en: '{files} files · {changed} changed', ja: '{files} ファイル · {changed} 件変更',
    'zh-Hans': '{files} 个文件 · {changed} 项更改', 'zh-Hant': '{files} 個檔案 · {changed} 項變更',
  },
  'savedialog.description': {
    en: 'Changed files are written directly in place without creating sidecar files. {selfCheck}',
    ja: '変更されたファイルは、追加ファイルを作成せずに直接上書きされます。{selfCheck}',
    'zh-Hans': '更改的文件将直接原地写入，不会创建附加文件。{selfCheck}',
    'zh-Hant': '變更的檔案將直接原地寫入，不會建立附加檔案。{selfCheck}',
  },
  'savedialog.noChanges': {
    en: 'No changes to save.', ja: '保存する変更はありません。',
    'zh-Hans': '没有要保存的更改。', 'zh-Hant': '沒有要儲存的變更。',
  },
  'savedialog.datatable': { en: 'Datatable', ja: 'データテーブル', 'zh-Hans': '数据表', 'zh-Hant': '資料表' },
  'savedialog.fumen': { en: 'Fumen', ja: '譜面', 'zh-Hans': '谱面', 'zh-Hant': '譜面' },
  'savedialog.soundBank': { en: 'Sound bank', ja: 'サウンドバンク', 'zh-Hans': '音源库', 'zh-Hant': '音源庫' },
  'savedialog.warnings': { en: 'Warnings', ja: '警告', 'zh-Hans': '警告', 'zh-Hant': '警告' },
  'savedialog.errors': { en: 'Errors', ja: 'エラー', 'zh-Hans': '错误', 'zh-Hant': '錯誤' },
  'savedialog.errorsBlock.one': {
    en: '✗ {n} error blocks save', ja: '✗ {n} 件のエラーで保存できません',
    'zh-Hans': '✗ {n} 个错误阻止保存', 'zh-Hant': '✗ {n} 個錯誤阻止儲存',
  },
  'savedialog.errorsBlock.other': {
    en: '✗ {n} errors block save', ja: '✗ {n} 件のエラーで保存できません',
    'zh-Hans': '✗ {n} 个错误阻止保存', 'zh-Hant': '✗ {n} 個錯誤阻止儲存',
  },
  'savedialog.roundTripVerified': {
    en: 'round-trip verified', ja: '往復変換を検証済み',
    'zh-Hans': '往返转换已验证', 'zh-Hant': '往返轉換已驗證',
  },
  'savedialog.saving': { en: 'Saving…', ja: '保存中…', 'zh-Hans': '保存中…', 'zh-Hant': '儲存中…' },

  // Music Order area
  'order.title': { en: 'Music Order', ja: '曲順', 'zh-Hans': '乐曲顺序', 'zh-Hant': '樂曲順序' },
  'order.emptyNoProject': {
    en: 'No project open. The music order list is empty.',
    ja: 'プロジェクトが開かれていません。曲順リストは空です。',
    'zh-Hans': '未打开项目。乐曲顺序列表为空。',
    'zh-Hant': '未開啟專案。樂曲順序清單為空。',
  },
  'order.dragHint': {
    en: 'drag to reorder within & across genres',
    ja: 'ドラッグでジャンル内・ジャンル間の並べ替え',
    'zh-Hans': '拖动以在类别内及类别间重新排序',
    'zh-Hant': '拖曳以在類別內及類別間重新排序',
  },
  'order.genres': { en: 'Genres', ja: 'ジャンル', 'zh-Hans': '类别', 'zh-Hant': '類別' },
  'order.entries': { en: 'Entries', ja: 'エントリ', 'zh-Hans': '条目', 'zh-Hant': '條目' },
  'order.compact': {
    en: 'Compact rows', ja: 'コンパクト表示',
    'zh-Hans': '紧凑显示', 'zh-Hant': '緊湊顯示',
  },
  'order.expand': {
    en: 'Full rows', ja: '通常表示',
    'zh-Hans': '完整显示', 'zh-Hant': '完整顯示',
  },
  'order.issue.duplicateSong': {
    en: '{song} appears more than once at indices {indices}.',
    ja: '{song} が曲順 {indices} に重複しています。',
    'zh-Hans': '{song} 在序号 {indices} 重复出现。',
    'zh-Hant': '{song} 在序號 {indices} 重複出現。',
  },
  'order.addSong': { en: 'Add a song', ja: '楽曲を追加', 'zh-Hans': '添加歌曲', 'zh-Hant': '新增樂曲' },
  'order.addSongIntro': {
    en: 'Pick a song to insert at the top of this genre.',
    ja: 'このジャンルの先頭に挿入する楽曲を選択します。',
    'zh-Hans': '选择一首歌曲插入到该类别的顶部。',
    'zh-Hant': '選擇一首樂曲插入到該類別的頂部。',
  },
  'order.noMatchingSongs': {
    en: 'No matching songs', ja: '一致する楽曲がありません',
    'zh-Hans': '没有匹配的歌曲', 'zh-Hant': '沒有符合的樂曲',
  },
  'order.menu.moveTop': {
    en: 'Move to top', ja: '先頭へ移動',
    'zh-Hans': '移到顶部', 'zh-Hant': '移到頂部',
  },
  'order.menu.moveUp': { en: 'Move up', ja: '上へ移動', 'zh-Hans': '上移', 'zh-Hant': '上移' },
  'order.menu.moveDown': { en: 'Move down', ja: '下へ移動', 'zh-Hans': '下移', 'zh-Hant': '下移' },
  'order.menu.moveBottom': {
    en: 'Move to bottom', ja: '末尾へ移動',
    'zh-Hans': '移到底部', 'zh-Hant': '移到底部',
  },
  'order.menu.showInEditor': {
    en: 'Show in editor', ja: 'エディタで表示',
    'zh-Hans': '在编辑器中显示', 'zh-Hant': '在編輯器中顯示',
  },
  'order.menu.remove': {
    en: 'Remove from list', ja: 'リストから削除',
    'zh-Hans': '从列表中移除', 'zh-Hant': '從清單中移除',
  },

  // Dani Dojo / Gaiden
  'dani.title': { en: 'Dani Dojo', ja: '段位道場', 'zh-Hans': '段位道场', 'zh-Hant': '段位道場' },
  'gaiden.label': { en: 'Gaiden', ja: '外伝', 'zh-Hans': '外传', 'zh-Hant': '外傳' },
  'dani.normal': { en: 'Normal', ja: '通常', 'zh-Hans': '常规', 'zh-Hant': '常規' },
  'dani.dansCount': { en: '{n} / {max} dans', ja: '{n} / {max} 段', 'zh-Hans': '{n} / {max} 段', 'zh-Hant': '{n} / {max} 段' },
  'dani.notLoaded': { en: '— not loaded —', ja: '— 未読み込み —', 'zh-Hans': '— 未加载 —', 'zh-Hant': '— 未載入 —' },
  'dani.setsCount.one': { en: '{n} set', ja: '{n} セット', 'zh-Hans': '{n} 组', 'zh-Hant': '{n} 組' },
  'dani.setsCount.other': { en: '{n} sets', ja: '{n} セット', 'zh-Hans': '{n} 组', 'zh-Hant': '{n} 組' },
  'dani.allValid': {
    en: 'all loaded dans valid', ja: '読み込んだ全段位が有効',
    'zh-Hans': '所有已加载段位有效', 'zh-Hant': '所有已載入段位有效',
  },
  'dani.issuesBlock.one': {
    en: '{n} issue blocks save', ja: '{n} 件の問題で保存できません',
    'zh-Hans': '{n} 个问题阻止保存', 'zh-Hant': '{n} 個問題阻止儲存',
  },
  'dani.issuesBlock.other': {
    en: '{n} issues block save', ja: '{n} 件の問題で保存できません',
    'zh-Hans': '{n} 个问题阻止保存', 'zh-Hant': '{n} 個問題阻止儲存',
  },
  'dani.cleared': { en: '— cleared —', ja: '— 未設定 —', 'zh-Hans': '— 已清空 —', 'zh-Hant': '— 已清空 —' },
  'dani.songNoLabel': { en: 'Song No. {n}', ja: '楽曲番号 {n}', 'zh-Hans': '歌曲编号 {n}', 'zh-Hant': '歌曲編號 {n}' },
  'dani.allDansAdded': {
    en: 'All {max} dans added', ja: '全 {max} 段を追加済み',
    'zh-Hans': '已添加全部 {max} 段', 'zh-Hant': '已新增全部 {max} 段',
  },
  'dani.addNextDan': {
    en: 'Add next dan · {jp}', ja: '次の段を追加 · {jp}',
    'zh-Hans': '添加下一段 · {jp}', 'zh-Hant': '新增下一段 · {jp}',
  },
  'gaiden.addSet': { en: 'Add gaiden set', ja: '外伝セットを追加', 'zh-Hans': '添加外传组', 'zh-Hant': '新增外傳組' },
  'dani.loadTitle': {
    en: 'Open a dani JSON file', ja: '段位 JSON ファイルを開く',
    'zh-Hans': '打开段位 JSON 文件', 'zh-Hant': '開啟段位 JSON 檔案',
  },
  'dani.newTitle': {
    en: 'Start a new dani file', ja: '新しい段位ファイルを作成',
    'zh-Hans': '新建段位文件', 'zh-Hant': '新建段位檔案',
  },
  'dani.noPickerTitle': {
    en: 'This browser has no file picker (Chromium only)',
    ja: 'このブラウザにはファイルピッカーがありません（Chromium のみ）',
    'zh-Hans': '此浏览器没有文件选择器（仅限 Chromium）',
    'zh-Hant': '此瀏覽器沒有檔案選擇器（僅限 Chromium）',
  },
  'dani.closeFile': {
    en: 'Close file', ja: 'ファイルを閉じる',
    'zh-Hans': '关闭文件', 'zh-Hant': '關閉檔案',
  },
  'dani.discardTitle': {
    en: 'Unsaved changes', ja: '未保存の変更',
    'zh-Hans': '未保存的更改', 'zh-Hant': '未儲存的變更',
  },
  'dani.discard': { en: 'Discard', ja: '破棄', 'zh-Hans': '放弃', 'zh-Hant': '捨棄' },
  'dani.discardUnsaved': {
    en: 'Discard the unsaved changes in this file?',
    ja: 'このファイルの未保存の変更を破棄しますか？',
    'zh-Hans': '要放弃此文件中未保存的更改吗？',
    'zh-Hant': '要捨棄此檔案中未儲存的變更嗎？',
  },
  'dani.saveSection': { en: 'Save {name}', ja: '{name}を保存', 'zh-Hans': '保存{name}', 'zh-Hant': '儲存{name}' },
  'dani.danN': { en: 'dan {id}', ja: '段 {id}', 'zh-Hans': '段 {id}', 'zh-Hant': '段 {id}' },
  'dani.blocksSave': { en: 'Blocks save', ja: '保存をブロック', 'zh-Hans': '阻止保存', 'zh-Hant': '阻止儲存' },
  'dani.secEmptyNormal': {
    en: 'No file loaded. Load {file}, or start a new empty file.',
    ja: 'ファイル未読み込み。{file} を読み込むか、新しい空のファイルを作成してください。',
    'zh-Hans': '未加载文件。加载 {file}，或新建一个空文件。',
    'zh-Hant': '未載入檔案。載入 {file}，或新建一個空檔案。',
  },
  'gaiden.secEmpty': {
    en: 'Gaiden dans are optional bonus sets, stored in their own {file}.',
    ja: '外伝段位は任意のボーナスセットで、独自の {file} に保存されます。',
    'zh-Hans': '外传段位是可选的奖励组，存储在各自的 {file} 中。',
    'zh-Hant': '外傳段位是可選的獎勵組，儲存在各自的 {file} 中。',
  },
  'dani.emptySelectTitle': {
    en: 'Select a dan to edit', ja: '編集する段を選択',
    'zh-Hans': '选择要编辑的段', 'zh-Hant': '選擇要編輯的段',
  },
  'dani.emptyOpenTitle': {
    en: 'Open a dan file to start', ja: '段位ファイルを開いて開始',
    'zh-Hans': '打开段位文件以开始', 'zh-Hant': '開啟段位檔案以開始',
  },
  'dani.emptySelectSub': {
    en: 'Pick a dan from the left panel to edit its songs and clear criteria.',
    ja: '左パネルから段を選び、楽曲とクリア条件を編集します。',
    'zh-Hans': '从左侧面板选择一个段，编辑其歌曲和通关条件。',
    'zh-Hant': '從左側面板選擇一個段，編輯其歌曲和通關條件。',
  },
  'dani.emptyOpenSub': {
    en: 'Load {file} from the left panel to begin — or start a new file. The Gaiden file is optional and lives separately.',
    ja: '左パネルから {file} を読み込んで開始 — または新しいファイルを作成します。外伝ファイルは任意で、別に保存されます。',
    'zh-Hans': '从左侧面板加载 {file} 开始——或新建文件。外传文件是可选的，单独存放。',
    'zh-Hant': '從左側面板載入 {file} 開始——或新建檔案。外傳檔案是可選的，單獨存放。',
  },
  'gaiden.titleKeyTitle': {
    en: 'Gaiden title key (free text)', ja: '外伝タイトルキー（自由入力）',
    'zh-Hans': '外传标题键（自由文本）', 'zh-Hant': '外傳標題鍵（自由文字）',
  },
  'dani.verupNo': { en: 'verupNo {n}', ja: 'verupNo {n}', 'zh-Hans': 'verupNo {n}', 'zh-Hant': 'verupNo {n}' },
  'dani.titleCrumb': { en: 'title: {title}', ja: 'タイトル: {title}', 'zh-Hans': '标题：{title}', 'zh-Hant': '標題：{title}' },
  'dani.clearData': { en: 'Clear data', ja: 'データをクリア', 'zh-Hans': '清除数据', 'zh-Hant': '清除資料' },
  'dani.clearDataTitle': {
    en: "Reset this dan's songs and criteria", ja: 'この段の楽曲と条件をリセット',
    'zh-Hans': '重置此段的歌曲和条件', 'zh-Hant': '重置此段的歌曲和條件',
  },
  'dani.removeThisDan': { en: 'Remove this dan', ja: 'この段を削除', 'zh-Hans': '移除此段', 'zh-Hant': '移除此段' },
  'dani.removeTrailingOnly': {
    en: 'Only the trailing dan can be removed (no gaps allowed).',
    ja: '末尾の段のみ削除できます（欠番は不可）。',
    'zh-Hans': '仅可删除末尾的段（不允许有空缺）。',
    'zh-Hant': '僅可刪除末尾的段（不允許有空缺）。',
  },
  'dani.removeDan': { en: 'Remove dan', ja: '段を削除', 'zh-Hans': '删除段', 'zh-Hant': '刪除段' },
  'dani.clearedTitle': { en: 'This dan is cleared.', ja: 'この段は空です。', 'zh-Hans': '此段已清空。', 'zh-Hant': '此段已清空。' },
  'dani.clearedBody': {
    en: 'Pick songs to fill it, or use Remove dan (only the trailing dan is removable). While any dan is empty, its file cannot be saved.',
    ja: '楽曲を追加するか、「段を削除」を使用してください（削除できるのは末尾の段のみ）。空の段がある間、そのファイルは保存できません。',
    'zh-Hans': '添加歌曲以填充，或使用“删除段”（仅末尾的段可删除）。只要有段为空，该文件就无法保存。',
    'zh-Hant': '新增歌曲以填充，或使用「刪除段」（僅末尾的段可刪除）。只要有段為空，該檔案就無法儲存。',
  },
  'dani.odaiSongs': { en: 'Odai songs', ja: 'お題楽曲', 'zh-Hans': '课题歌曲', 'zh-Hant': '課題歌曲' },
  'dani.songCount.one': { en: '{n} song', ja: '{n} 曲', 'zh-Hans': '{n} 首', 'zh-Hant': '{n} 首' },
  'dani.songCount.other': { en: '{n} songs', ja: '{n} 曲', 'zh-Hans': '{n} 首', 'zh-Hant': '{n} 首' },
  'dani.exactSongs': {
    en: 'A dan has exactly {n} songs', ja: '1 つの段はちょうど {n} 曲です',
    'zh-Hans': '一个段正好有 {n} 首歌曲', 'zh-Hant': '一個段正好有 {n} 首歌曲',
  },
  'dani.addSongSlot': { en: 'Add a song slot', ja: '楽曲スロットを追加', 'zh-Hans': '添加歌曲槽', 'zh-Hant': '新增歌曲槽' },
  'dani.clearCriteria': { en: 'Clear criteria', ja: 'クリア条件', 'zh-Hans': '通关条件', 'zh-Hant': '通關條件' },
  'dani.evaluatedOver': {
    en: 'evaluated over the 3-song set', ja: '3 曲セット全体で評価',
    'zh-Hans': '在 3 首歌曲的整组上评估', 'zh-Hant': '在 3 首歌曲的整組上評估',
  },
  'dani.addCriterion': { en: 'Add criterion', ja: '条件を追加', 'zh-Hans': '添加条件', 'zh-Hant': '新增條件' },
  'dani.noCriteria': {
    en: 'No criteria — every run passes by default. Add at least one clear condition.',
    ja: '条件なし — デフォルトで全て合格します。少なくとも 1 つのクリア条件を追加してください。',
    'zh-Hans': '无条件——默认全部通过。请至少添加一个通关条件。',
    'zh-Hant': '無條件——預設全部通過。請至少新增一個通關條件。',
  },
  'dani.notFound': { en: 'not found in the catalog', ja: 'カタログに見つかりません', 'zh-Hans': '在目录中未找到', 'zh-Hant': '在目錄中未找到' },
  'dani.openProjectForTitle': {
    en: 'open a game project for the title', ja: 'タイトル表示にはゲームプロジェクトを開いてください',
    'zh-Hans': '打开游戏项目以显示标题', 'zh-Hant': '開啟遊戲專案以顯示標題',
  },
  'dani.noSongSelected': { en: 'No song selected', ja: '楽曲が選択されていません', 'zh-Hans': '未选择歌曲', 'zh-Hant': '未選擇歌曲' },
  'dani.tapToChoose': {
    en: 'Tap the ♪ to choose a song', ja: '♪ をタップして楽曲を選択',
    'zh-Hans': '点击 ♪ 选择歌曲', 'zh-Hant': '點擊 ♪ 選擇歌曲',
  },
  'dani.chooseSong': { en: 'Choose a song', ja: '楽曲を選択', 'zh-Hans': '选择歌曲', 'zh-Hant': '選擇歌曲' },
  'dani.slotN': { en: 'Song {n}', ja: '課題曲 {n}', 'zh-Hans': '课题曲 {n}', 'zh-Hant': '課題曲 {n}' },
  'dani.course': { en: 'Course', ja: 'コース', 'zh-Hans': '难度', 'zh-Hant': '難度' },
  'dani.songName': { en: 'Song name', ja: '曲名', 'zh-Hans': '曲名', 'zh-Hant': '曲名' },
  'dani.shown': { en: 'Shown', ja: '表示', 'zh-Hans': '显示', 'zh-Hant': '顯示' },
  'dani.hidden': { en: 'Hidden', ja: '隠す', 'zh-Hans': '隐藏', 'zh-Hant': '隱藏' },
  'dani.wholeSet': { en: 'Whole set', ja: 'セット全体', 'zh-Hans': '整组', 'zh-Hant': '整組' },
  'dani.perSong': { en: 'Per song', ja: '曲ごと', 'zh-Hans': '每首', 'zh-Hant': '每首' },
  'dani.removeCriterion': { en: 'Remove criterion', ja: '条件を削除', 'zh-Hans': '移除条件', 'zh-Hant': '移除條件' },
  'dani.passLt': { en: '< pass', ja: '< 合格', 'zh-Hans': '< 合格', 'zh-Hant': '< 合格' },
  'dani.passGeq': { en: '≥ pass', ja: '≥ 合格', 'zh-Hans': '≥ 合格', 'zh-Hant': '≥ 合格' },
  'dani.goldLt': { en: '< gold', ja: '< 金', 'zh-Hans': '< 金', 'zh-Hant': '< 金' },
  'dani.goldGeq': { en: '≥ gold', ja: '≥ 金', 'zh-Hans': '≥ 金', 'zh-Hant': '≥ 金' },
  'dani.redBorder': { en: 'Red border ({word})', ja: '赤ボーダー（{word}）', 'zh-Hans': '红线（{word}）', 'zh-Hant': '紅線（{word}）' },
  'dani.goldBorder': { en: 'Gold border ({word})', ja: '金ボーダー（{word}）', 'zh-Hans': '金线（{word}）', 'zh-Hant': '金線（{word}）' },
  'dani.songN': { en: 'Song {n}', ja: '{n} 曲目', 'zh-Hans': '第 {n} 首', 'zh-Hant': '第 {n} 首' },
  'dani.noIssues': {
    en: 'No issues — this dan is ready to save.', ja: '問題なし — この段は保存できます。',
    'zh-Hans': '无问题——此段可以保存。', 'zh-Hant': '無問題——此段可以儲存。',
  },
  'dani.validation': { en: 'Validation', ja: '検証', 'zh-Hans': '验证', 'zh-Hant': '驗證' },
  'dani.pickSong': { en: 'Pick a song', ja: '楽曲を選択', 'zh-Hans': '选择歌曲', 'zh-Hant': '選擇歌曲' },
  'dani.pickerPill': {
    en: 'slot {n} · {total} songs', ja: 'スロット {n} · {total} 曲',
    'zh-Hans': '槽 {n} · {total} 首', 'zh-Hant': '槽 {n} · {total} 首',
  },
  'dani.pickerPillNoCount': { en: 'slot {n}', ja: 'スロット {n}', 'zh-Hans': '槽 {n}', 'zh-Hant': '槽 {n}' },
  'dani.pickerIntro': {
    en: "Search by title, Song ID, or Song No. The selected Song No. (musicinfo.uniqueId) is written to the slot's songNo field.",
    ja: 'タイトル・楽曲ID・楽曲番号で検索します。選択した楽曲番号（musicinfo.uniqueId）はスロットの songNo フィールドに書き込まれます。',
    'zh-Hans': '按标题、歌曲 ID 或歌曲编号搜索。所选歌曲编号（musicinfo.uniqueId）将写入槽的 songNo 字段。',
    'zh-Hant': '按標題、歌曲 ID 或歌曲編號搜尋。所選歌曲編號（musicinfo.uniqueId）將寫入槽的 songNo 欄位。',
  },
  'dani.pickerIntroNoCatalog': {
    en: "No game project is open, so titles aren't available — enter the Song No. (musicinfo.uniqueId) directly.",
    ja: 'ゲームプロジェクトが開かれていないため、タイトルは利用できません — 楽曲番号（musicinfo.uniqueId）を直接入力してください。',
    'zh-Hans': '未打开游戏项目，因此无法获取标题——请直接输入歌曲编号（musicinfo.uniqueId）。',
    'zh-Hant': '未開啟遊戲專案，因此無法取得標題——請直接輸入歌曲編號（musicinfo.uniqueId）。',
  },
  'dani.noMatchingSongs': { en: 'No matching songs.', ja: '一致する楽曲がありません。', 'zh-Hans': '没有匹配的歌曲。', 'zh-Hant': '沒有相符的歌曲。' },
  'dani.setSongNo': { en: 'Set Song No.', ja: '楽曲番号を設定', 'zh-Hans': '设置歌曲编号', 'zh-Hant': '設定歌曲編號' },
  'dani.saveNormalTitle': { en: 'Save Normal Dojo', ja: '通常道場を保存', 'zh-Hans': '保存常规道场', 'zh-Hant': '儲存常規道場' },
  'dani.saveGaidenTitle': { en: 'Save Gaiden', ja: '外伝を保存', 'zh-Hans': '保存外传', 'zh-Hant': '儲存外傳' },
  'dani.changeCount.one': { en: '{n} change', ja: '{n} 件の変更', 'zh-Hans': '{n} 项更改', 'zh-Hant': '{n} 項變更' },
  'dani.changeCount.other': { en: '{n} changes', ja: '{n} 件の変更', 'zh-Hans': '{n} 项更改', 'zh-Hant': '{n} 項變更' },
  'dani.saveDesc': {
    en: 'Writes {file} in place (plaintext, 2-space indent, no trailing newline) without creating a sidecar file.',
    ja: '{file} を直接書き込みます（プレーンテキスト、2 スペースインデント、末尾改行なし）。追加ファイルは作成しません。',
    'zh-Hans': '直接原地写入 {file}（纯文本，2 空格缩进，无尾随换行）。不会创建附加文件。',
    'zh-Hant': '直接原地寫入 {file}（純文字，2 空格縮排，無尾隨換行）。不會建立附加檔案。',
  },
  'dani.changedDans': { en: 'Changed dans', ja: '変更された段', 'zh-Hans': '已更改的段', 'zh-Hant': '已變更的段' },
  'dani.newDanAdded': { en: 'new dan added', ja: '新しい段を追加', 'zh-Hans': '已添加新段', 'zh-Hant': '已新增新段' },
  'dani.danRemoved': { en: 'dan removed', ja: '段を削除', 'zh-Hans': '已删除段', 'zh-Hant': '已刪除段' },
  'dani.errorsBlocked': {
    en: 'Errors — save blocked', ja: 'エラー — 保存がブロックされました',
    'zh-Hans': '错误——保存被阻止', 'zh-Hant': '錯誤——儲存被阻止',
  },
  'dani.readyToSave': { en: 'ready to save', ja: '保存準備完了', 'zh-Hans': '可以保存', 'zh-Hant': '可以儲存' },
} satisfies Record<string, Record<UiLang, string>>;

export type MessageKey = keyof typeof messages;

/**
 * Look up a message for a language, with `{placeholder}` interpolation.
 * Falls back to English, then to the raw key, so a missing translation is
 * always visible rather than crashing.
 */
export function translate(
  key: MessageKey,
  lang: UiLang,
  params?: Record<string, string | number>,
): string {
  const row = messages[key] as Record<UiLang, string> | undefined;
  const template = row?.[lang] ?? row?.en ?? (key as string);
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
