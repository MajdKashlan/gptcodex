import { InjectionToken } from '@angular/core';

export interface ErpNextConfig {
  /** ERPNext site root, with no trailing slash. */
  baseUrl: string;
}

export const ERP_NEXT_CONFIG = new InjectionToken<ErpNextConfig>('ERP_NEXT_CONFIG');

export const erpNextConfig: ErpNextConfig = {
  baseUrl: 'https://erp.hmgtr.com',
};
