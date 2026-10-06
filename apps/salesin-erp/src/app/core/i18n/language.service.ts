import { computed, effect, Injectable, signal } from '@angular/core';
import { AppLanguage, TRANSLATIONS } from './translations';

const STORAGE_KEY = 'salesin.language';

/**
 * Owns the active language and the document direction.
 *
 * Templates should call `i18n.t('some.key')` rather than using a pipe: a pure pipe
 * would cache its result and never re-render on a language change, while an impure
 * pipe re-runs on every change-detection cycle. A method call that reads the
 * `current` signal is both reactive and cheap.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly language = signal<AppLanguage>(this.readStoredLanguage());

  readonly current = this.language.asReadonly();
  readonly direction = computed<'ltr' | 'rtl'>(() =>
    this.language() === 'ar' ? 'rtl' : 'ltr',
  );
  readonly isRtl = computed(() => this.direction() === 'rtl');

  constructor() {
    // Keep <html lang> and <html dir> in step; index.html defaults to Arabic so
    // there is no left-to-right flash before the app boots.
    effect(() => {
      this.applyToDocument(this.language());
    });
  }

  setLanguage(language: AppLanguage): void {
    this.language.set(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // Storage can be unavailable (private mode); the in-memory value still works.
    }
  }

  toggle(): void {
    this.setLanguage(this.language() === 'ar' ? 'en' : 'ar');
  }

  /** Resolves a key, falling back to English and finally to the key itself. */
  t(key: string): string {
    const bundle = TRANSLATIONS[this.language()];
    return bundle[key] ?? TRANSLATIONS.en[key] ?? key;
  }

  private readStoredLanguage(): AppLanguage {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'ar' || stored === 'en') {
        return stored;
      }
    } catch {
      // Ignore and fall through to the default.
    }
    return 'ar';
  }

  private applyToDocument(language: AppLanguage): void {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    root.lang = language;
    root.dir = language === 'ar' ? 'rtl' : 'ltr';
  }
}
