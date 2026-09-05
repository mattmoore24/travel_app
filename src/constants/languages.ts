// Every ISO 639-1 language, as codes plus an English name and the endonym.
//
// English leads the list on purpose (the founder's call, and it is the
// app's own language); everything else is alphabetical by English name so a
// person scrolling rather than searching can find their way.
//
// Written out rather than derived from Intl.DisplayNames: that API's output
// depends on the device's ICU data, which would make one traveler's profile
// read differently on someone else's phone and make this list untestable.
export const LANGUAGES = [
  { value: 'en', label: 'English', native: 'English' },
  { value: 'ab', label: 'Abkhaz', native: 'Аҧсуа' },
  { value: 'aa', label: 'Afar', native: 'Afaraf' },
  { value: 'af', label: 'Afrikaans', native: 'Afrikaans' },
  { value: 'ak', label: 'Akan', native: 'Akan' },
  { value: 'sq', label: 'Albanian', native: 'Shqip' },
  { value: 'am', label: 'Amharic', native: 'አማርኛ' },
  { value: 'ar', label: 'Arabic', native: 'العربية' },
  { value: 'an', label: 'Aragonese', native: 'Aragonés' },
  { value: 'hy', label: 'Armenian', native: 'Հայերեն' },
  { value: 'as', label: 'Assamese', native: 'অসমীয়া' },
  { value: 'av', label: 'Avaric', native: 'Авар' },
  { value: 'ae', label: 'Avestan', native: 'Avesta' },
  { value: 'ay', label: 'Aymara', native: 'Aymar aru' },
  { value: 'az', label: 'Azerbaijani', native: 'Azərbaycan dili' },
  { value: 'bm', label: 'Bambara', native: 'Bamanankan' },
  { value: 'ba', label: 'Bashkir', native: 'Башҡорт теле' },
  { value: 'eu', label: 'Basque', native: 'Euskara' },
  { value: 'be', label: 'Belarusian', native: 'Беларуская' },
  { value: 'bn', label: 'Bengali', native: 'বাংলা' },
  { value: 'bh', label: 'Bihari', native: 'भोजपुरी' },
  { value: 'bi', label: 'Bislama', native: 'Bislama' },
  { value: 'bs', label: 'Bosnian', native: 'Bosanski' },
  { value: 'br', label: 'Breton', native: 'Brezhoneg' },
  { value: 'bg', label: 'Bulgarian', native: 'Български' },
  { value: 'my', label: 'Burmese', native: 'ဗမာစာ' },
  { value: 'ca', label: 'Catalan', native: 'Català' },
  { value: 'ch', label: 'Chamorro', native: 'Chamoru' },
  { value: 'ce', label: 'Chechen', native: 'Нохчийн' },
  { value: 'ny', label: 'Chichewa', native: 'ChiCheŵa' },
  { value: 'zh', label: 'Chinese', native: '中文' },
  { value: 'cu', label: 'Church Slavonic', native: 'Словѣньскъ' },
  { value: 'cv', label: 'Chuvash', native: 'Чӑваш чӗлхи' },
  { value: 'kw', label: 'Cornish', native: 'Kernewek' },
  { value: 'co', label: 'Corsican', native: 'Corsu' },
  { value: 'cr', label: 'Cree', native: 'ᓀᐦᐃᔭᐍᐏᐣ' },
  { value: 'hr', label: 'Croatian', native: 'Hrvatski' },
  { value: 'cs', label: 'Czech', native: 'Čeština' },
  { value: 'da', label: 'Danish', native: 'Dansk' },
  { value: 'dv', label: 'Divehi', native: 'ދިވެހި' },
  { value: 'nl', label: 'Dutch', native: 'Nederlands' },
  { value: 'dz', label: 'Dzongkha', native: 'རྫོང་ཁ' },
  { value: 'eo', label: 'Esperanto', native: 'Esperanto' },
  { value: 'et', label: 'Estonian', native: 'Eesti' },
  { value: 'ee', label: 'Ewe', native: 'Eʋegbe' },
  { value: 'fo', label: 'Faroese', native: 'Føroyskt' },
  { value: 'fj', label: 'Fijian', native: 'Vosa Vakaviti' },
  { value: 'fi', label: 'Finnish', native: 'Suomi' },
  { value: 'fr', label: 'French', native: 'Français' },
  { value: 'ff', label: 'Fula', native: 'Fulfulde' },
  { value: 'gl', label: 'Galician', native: 'Galego' },
  { value: 'lg', label: 'Ganda', native: 'Luganda' },
  { value: 'ka', label: 'Georgian', native: 'ქართული' },
  { value: 'de', label: 'German', native: 'Deutsch' },
  { value: 'el', label: 'Greek', native: 'Ελληνικά' },
  { value: 'gn', label: 'Guaraní', native: 'Avañeẽ' },
  { value: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  { value: 'ht', label: 'Haitian Creole', native: 'Kreyòl ayisyen' },
  { value: 'ha', label: 'Hausa', native: 'Hausa' },
  { value: 'he', label: 'Hebrew', native: 'עברית' },
  { value: 'hz', label: 'Herero', native: 'Otjiherero' },
  { value: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { value: 'ho', label: 'Hiri Motu', native: 'Hiri Motu' },
  { value: 'hu', label: 'Hungarian', native: 'Magyar' },
  { value: 'is', label: 'Icelandic', native: 'Íslenska' },
  { value: 'io', label: 'Ido', native: 'Ido' },
  { value: 'ig', label: 'Igbo', native: 'Asụsụ Igbo' },
  { value: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { value: 'ia', label: 'Interlingua', native: 'Interlingua' },
  { value: 'ie', label: 'Interlingue', native: 'Interlingue' },
  { value: 'iu', label: 'Inuktitut', native: 'ᐃᓄᒃᑎᑐᑦ' },
  { value: 'ik', label: 'Inupiaq', native: 'Iñupiaq' },
  { value: 'ga', label: 'Irish', native: 'Gaeilge' },
  { value: 'it', label: 'Italian', native: 'Italiano' },
  { value: 'ja', label: 'Japanese', native: '日本語' },
  { value: 'jv', label: 'Javanese', native: 'Basa Jawa' },
  { value: 'kl', label: 'Kalaallisut', native: 'Kalaallisut' },
  { value: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { value: 'kr', label: 'Kanuri', native: 'Kanuri' },
  { value: 'ks', label: 'Kashmiri', native: 'कश्मीरी' },
  { value: 'kk', label: 'Kazakh', native: 'Қазақ тілі' },
  { value: 'km', label: 'Khmer', native: 'ភាសាខ្មែរ' },
  { value: 'ki', label: 'Kikuyu', native: 'Gĩkũyũ' },
  { value: 'rw', label: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { value: 'rn', label: 'Kirundi', native: 'Ikirundi' },
  { value: 'kv', label: 'Komi', native: 'Коми кыв' },
  { value: 'kg', label: 'Kongo', native: 'Kikongo' },
  { value: 'ko', label: 'Korean', native: '한국어' },
  { value: 'ku', label: 'Kurdish', native: 'Kurdî' },
  { value: 'kj', label: 'Kwanyama', native: 'Kuanyama' },
  { value: 'ky', label: 'Kyrgyz', native: 'Кыргызча' },
  { value: 'lo', label: 'Lao', native: 'ພາສາລາວ' },
  { value: 'la', label: 'Latin', native: 'Latine' },
  { value: 'lv', label: 'Latvian', native: 'Latviešu' },
  { value: 'li', label: 'Limburgish', native: 'Limburgs' },
  { value: 'ln', label: 'Lingala', native: 'Lingála' },
  { value: 'lt', label: 'Lithuanian', native: 'Lietuvių' },
  { value: 'lu', label: 'Luba-Katanga', native: 'Tshiluba' },
  { value: 'lb', label: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { value: 'mk', label: 'Macedonian', native: 'Македонски' },
  { value: 'mg', label: 'Malagasy', native: 'Malagasy' },
  { value: 'ms', label: 'Malay', native: 'Bahasa Melayu' },
  { value: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { value: 'mt', label: 'Maltese', native: 'Malti' },
  { value: 'gv', label: 'Manx', native: 'Gaelg' },
  { value: 'mi', label: 'Māori', native: 'Te Reo Māori' },
  { value: 'mr', label: 'Marathi', native: 'मराठी' },
  { value: 'mh', label: 'Marshallese', native: 'Kajin M̧ajeļ' },
  { value: 'mn', label: 'Mongolian', native: 'Монгол' },
  { value: 'na', label: 'Nauru', native: 'Dorerin Naoero' },
  { value: 'nv', label: 'Navajo', native: 'Diné bizaad' },
  { value: 'ng', label: 'Ndonga', native: 'Owambo' },
  { value: 'ne', label: 'Nepali', native: 'नेपाली' },
  { value: 'nd', label: 'Northern Ndebele', native: 'isiNdebele' },
  { value: 'se', label: 'Northern Sami', native: 'Davvisámegiella' },
  { value: 'no', label: 'Norwegian', native: 'Norsk' },
  { value: 'nb', label: 'Norwegian Bokmål', native: 'Norsk bokmål' },
  { value: 'nn', label: 'Norwegian Nynorsk', native: 'Norsk nynorsk' },
  { value: 'ii', label: 'Nuosu', native: 'ꆈꌠ꒿ Nuosuhxop' },
  { value: 'oc', label: 'Occitan', native: 'Occitan' },
  { value: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  { value: 'oj', label: 'Ojibwe', native: 'ᐊᓂᔑᓈᐯᒧᐎᓐ' },
  { value: 'om', label: 'Oromo', native: 'Afaan Oromoo' },
  { value: 'os', label: 'Ossetian', native: 'Ирон' },
  { value: 'pi', label: 'Pāli', native: 'पाऴि' },
  { value: 'ps', label: 'Pashto', native: 'پښتو' },
  { value: 'fa', label: 'Persian', native: 'فارسی' },
  { value: 'pl', label: 'Polish', native: 'Polski' },
  { value: 'pt', label: 'Portuguese', native: 'Português' },
  { value: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { value: 'qu', label: 'Quechua', native: 'Runa Simi' },
  { value: 'ro', label: 'Romanian', native: 'Română' },
  { value: 'rm', label: 'Romansh', native: 'Rumantsch' },
  { value: 'ru', label: 'Russian', native: 'Русский' },
  { value: 'sm', label: 'Samoan', native: 'Gagana Samoa' },
  { value: 'sg', label: 'Sango', native: 'Yângâ tî sängö' },
  { value: 'sa', label: 'Sanskrit', native: 'संस्कृतम्' },
  { value: 'sc', label: 'Sardinian', native: 'Sardu' },
  { value: 'gd', label: 'Scottish Gaelic', native: 'Gàidhlig' },
  { value: 'sr', label: 'Serbian', native: 'Српски' },
  { value: 'sn', label: 'Shona', native: 'ChiShona' },
  { value: 'sd', label: 'Sindhi', native: 'سنڌي' },
  { value: 'si', label: 'Sinhala', native: 'සිංහල' },
  { value: 'sk', label: 'Slovak', native: 'Slovenčina' },
  { value: 'sl', label: 'Slovene', native: 'Slovenščina' },
  { value: 'so', label: 'Somali', native: 'Soomaaliga' },
  { value: 'nr', label: 'Southern Ndebele', native: 'isiNdebele' },
  { value: 'st', label: 'Southern Sotho', native: 'Sesotho' },
  { value: 'es', label: 'Spanish', native: 'Español' },
  { value: 'su', label: 'Sundanese', native: 'Basa Sunda' },
  { value: 'sw', label: 'Swahili', native: 'Kiswahili' },
  { value: 'ss', label: 'Swati', native: 'SiSwati' },
  { value: 'sv', label: 'Swedish', native: 'Svenska' },
  { value: 'tl', label: 'Tagalog', native: 'Tagalog' },
  { value: 'ty', label: 'Tahitian', native: 'Reo Tahiti' },
  { value: 'tg', label: 'Tajik', native: 'Тоҷикӣ' },
  { value: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { value: 'tt', label: 'Tatar', native: 'Татар теле' },
  { value: 'te', label: 'Telugu', native: 'తెలుగు' },
  { value: 'th', label: 'Thai', native: 'ไทย' },
  { value: 'bo', label: 'Tibetan', native: 'བོད་ཡིག' },
  { value: 'ti', label: 'Tigrinya', native: 'ትግርኛ' },
  { value: 'to', label: 'Tongan', native: 'Faka Tonga' },
  { value: 'ts', label: 'Tsonga', native: 'Xitsonga' },
  { value: 'tn', label: 'Tswana', native: 'Setswana' },
  { value: 'tr', label: 'Turkish', native: 'Türkçe' },
  { value: 'tk', label: 'Turkmen', native: 'Türkmen' },
  { value: 'tw', label: 'Twi', native: 'Twi' },
  { value: 'uk', label: 'Ukrainian', native: 'Українська' },
  { value: 'ur', label: 'Urdu', native: 'اردو' },
  { value: 'ug', label: 'Uyghur', native: 'ئۇيغۇرچە' },
  { value: 'uz', label: 'Uzbek', native: 'Oʻzbek' },
  { value: 've', label: 'Venda', native: 'Tshivenḓa' },
  { value: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { value: 'vo', label: 'Volapük', native: 'Volapük' },
  { value: 'wa', label: 'Walloon', native: 'Walon' },
  { value: 'cy', label: 'Welsh', native: 'Cymraeg' },
  { value: 'fy', label: 'Western Frisian', native: 'Frysk' },
  { value: 'wo', label: 'Wolof', native: 'Wollof' },
  { value: 'xh', label: 'Xhosa', native: 'isiXhosa' },
  { value: 'yi', label: 'Yiddish', native: 'ייִדיש' },
  { value: 'yo', label: 'Yoruba', native: 'Yorùbá' },
  { value: 'za', label: 'Zhuang', native: 'Saɯ cueŋƅ' },
  { value: 'zu', label: 'Zulu', native: 'isiZulu' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['value'];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.value as string, l]));

/** The English name for a stored code, or the code itself if it is unknown. */
export function languageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code;
}

/**
 * Matches on either name or the ISO code, so "German", "Deutsch" and "de" all
 * find de. Accents are stripped so "Espanol" finds Español.
 *
 * The code is the half that was missing, and it mattered: a Spanish speaker
 * typing "aleman", a French speaker typing "allemand" and a Portuguese
 * speaker typing "alemão" all got an empty list from a corpus that contains
 * their answer, on a required onboarding field that gates finishing signup.
 * The codes are the one spelling every traveler already knows, off every
 * airline and hotel site they have ever used.
 *
 * `===` on the code rather than `includes`, deliberately. A two-letter query
 * substring-matched against 200 entries is noise: "pt" would pull in
 * everything containing those letters. Equality means "pt" returns Portuguese
 * and the name match handles the rest.
 */
export function matchesLanguage(language: (typeof LANGUAGES)[number], query: string): boolean {
  const needle = fold(query);
  if (needle.length === 0) {
    return true;
  }
  return (
    language.value === needle ||
    fold(language.label).includes(needle) ||
    fold(language.native).includes(needle)
  );
}

function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}
