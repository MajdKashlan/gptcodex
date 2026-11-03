import { Pipe, PipeTransform } from '@angular/core';
import { DateStyle, formatDate } from '../../core/utils/date';
import { formatMoney, formatNumber } from '../../core/utils/format';

/** `{{ row.posting_date | appDate }}` - date-only safe, never shifts a day. */
@Pipe({ name: 'appDate' })
export class AppDatePipe implements PipeTransform {
  transform(value: string | null | undefined, style: DateStyle = 'medium'): string {
    return formatDate(value, style);
  }
}

/** `{{ total | money: row.currency }}` */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(value: number | null | undefined, currency?: string | null): string {
    return formatMoney(value, currency);
  }
}

/** `{{ qty | qty }}` */
@Pipe({ name: 'qty' })
export class QtyPipe implements PipeTransform {
  transform(value: number | null | undefined, digits = 2): string {
    return formatNumber(value, digits);
  }
}
