import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import all locale files
import ptBR from './locales/pt-BR.json';
import enUS from './locales/en-US.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import ko from './locales/ko.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';
import hi from './locales/hi.json';
import tr from './locales/tr.json';
import pl from './locales/pl.json';
import nl from './locales/nl.json';
import sv from './locales/sv.json';
import no from './locales/no.json';
import da from './locales/da.json';
import fi from './locales/fi.json';
import cs from './locales/cs.json';
import ro from './locales/ro.json';
import hu from './locales/hu.json';
import uk from './locales/uk.json';
import id from './locales/id.json';
import ms from './locales/ms.json';
import th from './locales/th.json';
import vi from './locales/vi.json';
import el from './locales/el.json';
import he from './locales/he.json';
import fa from './locales/fa.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'pt-BR', name: 'Português (Brasil)', flag: '🇧🇷', dir: 'ltr' },
  { code: 'en-US', name: 'English (US)', flag: '🇺🇸', dir: 'ltr' },
  { code: 'es', name: 'Español', flag: '🇪🇸', dir: 'ltr' },
  { code: 'fr', name: 'Français', flag: '🇫🇷', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  { code: 'it', name: 'Italiano', flag: '🇮🇹', dir: 'ltr' },
  { code: 'ja', name: '日本語', flag: '🇯🇵', dir: 'ltr' },
  { code: 'zh-CN', name: '中文 (简体)', flag: '🇨🇳', dir: 'ltr' },
  { code: 'zh-TW', name: '中文 (繁體)', flag: '🇹🇼', dir: 'ltr' },
  { code: 'ko', name: '한국어', flag: '🇰🇷', dir: 'ltr' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺', dir: 'ltr' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷', dir: 'ltr' },
  { code: 'pl', name: 'Polski', flag: '🇵🇱', dir: 'ltr' },
  { code: 'nl', name: 'Nederlands', flag: '🇳🇱', dir: 'ltr' },
  { code: 'sv', name: 'Svenska', flag: '🇸🇪', dir: 'ltr' },
  { code: 'no', name: 'Norsk', flag: '🇳🇴', dir: 'ltr' },
  { code: 'da', name: 'Dansk', flag: '🇩🇰', dir: 'ltr' },
  { code: 'fi', name: 'Suomi', flag: '🇫🇮', dir: 'ltr' },
  { code: 'cs', name: 'Čeština', flag: '🇨🇿', dir: 'ltr' },
  { code: 'ro', name: 'Română', flag: '🇷🇴', dir: 'ltr' },
  { code: 'hu', name: 'Magyar', flag: '🇭🇺', dir: 'ltr' },
  { code: 'uk', name: 'Українська', flag: '🇺🇦', dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', flag: '🇮🇩', dir: 'ltr' },
  { code: 'ms', name: 'Bahasa Melayu', flag: '🇲🇾', dir: 'ltr' },
  { code: 'th', name: 'ภาษาไทย', flag: '🇹🇭', dir: 'ltr' },
  { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳', dir: 'ltr' },
  { code: 'el', name: 'Ελληνικά', flag: '🇬🇷', dir: 'ltr' },
  { code: 'he', name: 'עברית', flag: '🇮🇱', dir: 'rtl' },
  { code: 'fa', name: 'فارسی', flag: '🇮🇷', dir: 'rtl' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'pt-BR': { translation: ptBR },
      'en-US': { translation: enUS },
      'es': { translation: es },
      'fr': { translation: fr },
      'de': { translation: de },
      'it': { translation: it },
      'ja': { translation: ja },
      'zh-CN': { translation: zhCN },
      'zh-TW': { translation: zhTW },
      'ko': { translation: ko },
      'ru': { translation: ru },
      'ar': { translation: ar },
      'hi': { translation: hi },
      'tr': { translation: tr },
      'pl': { translation: pl },
      'nl': { translation: nl },
      'sv': { translation: sv },
      'no': { translation: no },
      'da': { translation: da },
      'fi': { translation: fi },
      'cs': { translation: cs },
      'ro': { translation: ro },
      'hu': { translation: hu },
      'uk': { translation: uk },
      'id': { translation: id },
      'ms': { translation: ms },
      'th': { translation: th },
      'vi': { translation: vi },
      'el': { translation: el },
      'he': { translation: he },
      'fa': { translation: fa },
    },
    fallbackLng: 'pt-BR',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    }
  });

export default i18n;
