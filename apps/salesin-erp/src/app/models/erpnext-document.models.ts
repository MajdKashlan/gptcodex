/** Common fields returned by ERPNext/Frappe document endpoints. */
export interface ErpNextDocument {
  name: string;
  owner?: string;
  creation?: string;
  modified?: string;
  modified_by?: string;
  docstatus?: 0 | 1 | 2;
  idx?: number;
}

export interface ErpNextListResponse<T> {
  data: T[];
}

export interface ErpNextDocumentResponse<T> {
  data: T;
}
