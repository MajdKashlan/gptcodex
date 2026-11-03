import { Component, DestroyRef, forwardRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { catchError, debounceTime, distinctUntilChanged, of, Subject, switchMap } from 'rxjs';
import { FrappeApiService, FrappeFilter, LinkOption } from '../../../core/api/frappe-api.service';

let nextId = 0;

/**
 * Searchable ERPNext link field (customer, item, warehouse...).
 *
 * Replaces `<select>` lists that loaded "the first 500" records: options are fetched
 * from `frappe.desk.search.search_link` as the user types, so every record is
 * reachable and the page loads nothing up front. Uses a native `<datalist>`, which
 * gives a proper picker on desktop, Android and iOS without extra dependencies.
 */
@Component({
  selector: 'app-link-input',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => LinkInputComponent), multi: true }],
  template: `
    <input
      type="search"
      [attr.id]="inputId()"
      [attr.list]="listId"
      [placeholder]="placeholder()"
      [value]="value()"
      [disabled]="disabled()"
      autocomplete="off"
      (input)="onInput($any($event.target).value)"
      (change)="onCommit($any($event.target).value)"
      (focus)="onFocus()"
      (blur)="touched()"
    />
    <datalist [id]="listId">
      @for (option of options(); track option.value) {
        <option [value]="option.value">{{ option.description || option.value }}</option>
      }
    </datalist>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    input { width: 100%; }
  `,
})
export class LinkInputComponent implements ControlValueAccessor {
  private readonly api = inject(FrappeApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly doctype = input.required<string>();
  readonly filters = input<Record<string, unknown> | FrappeFilter[] | undefined>(undefined);
  readonly placeholder = input('Type to search…');
  readonly inputId = input<string | null>(null);
  /** Emits when the user picks / commits a value (after `change`). */
  readonly selected = output<string>();

  protected readonly listId = `link-input-${nextId++}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  protected readonly options = signal<LinkOption[]>([]);

  private readonly search$ = new Subject<string>();
  private onChange: (value: string) => void = () => undefined;
  protected touched: () => void = () => undefined;

  constructor() {
    this.search$
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap((txt) => this.api.searchLink(this.doctype(), txt, this.filters()).pipe(catchError(() => of([])))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => this.options.set(options));
  }

  protected onInput(text: string): void {
    this.value.set(text);
    this.onChange(text);
    // Picking a datalist option fires `input` with the full value: commit at once
    // so dependent fields (price, UOM) update without waiting for blur.
    if (this.options().some((option) => option.value === text)) {
      this.emitSelected(text);
    } else {
      this.search$.next(text);
    }
  }

  protected onCommit(text: string): void {
    this.value.set(text);
    this.onChange(text);
    this.emitSelected(text);
  }

  private lastEmitted = '';

  private emitSelected(text: string): void {
    if (text && text !== this.lastEmitted) {
      this.lastEmitted = text;
      this.selected.emit(text);
    }
  }

  protected onFocus(): void {
    if (!this.options().length) this.search$.next(this.value());
  }

  writeValue(value: string | null): void {
    this.value.set(value ?? '');
    this.lastEmitted = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.touched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled.set(disabled);
  }
}
