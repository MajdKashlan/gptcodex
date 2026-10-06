import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { ErpNextCustomer } from '../../models/customer.models';

export interface CustomerFormData {
  customer_name: string;
  alias: string;
  customer_type: string;
  customer_group: string;
  territory: string;
  default_currency: string;
  default_price_list: string;
  tax_id: string;
  tax_category: string;
  payment_terms: string;
  customer_details: string;
  is_frozen: 0 | 1;
  on_hold: 0 | 1;
  disabled: 0 | 1;
  portal_users: Array<{ user: string }>;
}

export interface CustomerOptions {
  groups: string[];
  territories: string[];
  currencies: string[];
  priceLists: string[];
  countries: string[];
  taxCategories: string[];
  paymentTerms: string[];
  itemGroups: string[];
  users: string[];
  paymentMethods: string[];
}

export interface CustomerContactData {
  first_name: string;
  last_name: string;
  email: string;
  business_phone: string;
  home_phone: string;
  mobile_phone: string;
  fax: string;
}

export interface CustomerAddressData {
  address_type: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  fax: string;
}

interface CustomerContactRecord {
  first_name?: string;
  last_name?: string;
  email_ids?: Array<{ email_id: string; is_primary?: 0 | 1 }>;
  phone_nos?: Array<{ phone: string; is_primary_phone?: 0 | 1; is_primary_mobile_no?: 0 | 1 }>;
}

interface CustomerAddressRecord {
  address_type?: string;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  fax?: string;
}

export interface CustomerEditorData {
  customer: ErpNextCustomer;
  contact: CustomerContactData;
  contactName: string;
  address: CustomerAddressData;
  addressName: string;
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  list(query = ''): Observable<ErpNextCustomer[]> {
    const fields = [
      'name',
      'customer_name',
      'customer_type',
      'customer_group',
      'territory',
      'default_currency',
      'default_price_list',
      'disabled',
      'modified',
    ];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '200')
      .set('order_by', 'modified desc');
    const term = query.trim();
    if (term) {
      params = params.set('or_filters', JSON.stringify([
        ['Customer', 'name', 'like', `%${term}%`],
        ['Customer', 'customer_name', 'like', `%${term}%`],
      ]));
    }

    return this.http
      .get<ErpNextListResponse<ErpNextCustomer>>(this.auth.apiUrl('/api/resource/Customer'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []));
  }

  loadOptions(): Observable<CustomerOptions> {
    return forkJoin({
      groups: this.listNames('Customer Group', [['Customer Group', 'is_group', '=', 0]]),
      territories: this.listNames('Territory', [['Territory', 'is_group', '=', 0]]),
      currencies: this.listNames('Currency'),
      priceLists: this.listNames('Price List', [['Price List', 'selling', '=', 1]]),
      countries: this.listNames('Country'),
      taxCategories: this.listNames('Tax Category'),
      paymentTerms: this.listNames('Payment Terms Template'),
      itemGroups: this.listNames('Item Group', [['Item Group', 'is_group', '=', 0]]),
      users: this.listNames('User', [['User', 'enabled', '=', 1]]),
      paymentMethods: this.listNames('Mode of Payment'),
    });
  }

  get(name: string): Observable<CustomerEditorData> {
    return this.http
      .get<{ data: ErpNextCustomer }>(
        this.auth.apiUrl('/api/resource/Customer/' + encodeURIComponent(name)),
        { withCredentials: true },
      )
      .pipe(
        map((response) => response.data),
        switchMap((customer) => forkJoin({
          customer: of(customer),
          contactName: of(customer.customer_primary_contact ?? ''),
          addressName: of(customer.customer_primary_address ?? ''),
          contact: customer.customer_primary_contact
            ? this.getContact(customer.customer_primary_contact)
            : of(this.emptyContact()),
          address: customer.customer_primary_address
            ? this.getAddress(customer.customer_primary_address)
            : of(this.emptyAddress()),
        })),
      );
  }

  create(
    details: CustomerFormData,
    contact: CustomerContactData,
    address: CustomerAddressData,
  ): Observable<ErpNextCustomer> {
    return this.http
      .post<{ data: ErpNextCustomer }>(this.auth.apiUrl('/api/resource/Customer'), details, {
        withCredentials: true,
      })
      .pipe(switchMap((response) => this.saveLinkedRecords(response.data, contact, address, '', '')));
  }

  update(
    name: string,
    details: CustomerFormData,
    contact: CustomerContactData,
    address: CustomerAddressData,
    contactName: string,
    addressName: string,
  ): Observable<ErpNextCustomer> {
    return this.http
      .put<{ data: ErpNextCustomer }>(
        this.auth.apiUrl('/api/resource/Customer/' + encodeURIComponent(name)),
        details,
        { withCredentials: true },
      )
      .pipe(switchMap((response) => this.saveLinkedRecords(
        response.data,
        contact,
        address,
        contactName,
        addressName,
      )));
  }

  private getContact(name: string): Observable<CustomerContactData> {
    return this.http
      .get<{ data: CustomerContactRecord }>(this.auth.apiUrl('/api/resource/Contact/' + encodeURIComponent(name)), {
        withCredentials: true,
      })
      .pipe(map(({ data }) => ({
        first_name: data.first_name ?? '',
        last_name: data.last_name ?? '',
        email: data.email_ids?.find((email) => email.is_primary)?.email_id ?? data.email_ids?.[0]?.email_id ?? '',
        business_phone: data.phone_nos?.find((phone) => phone.is_primary_phone)?.phone ?? '',
        home_phone: data.phone_nos?.[1]?.phone ?? '',
        mobile_phone: data.phone_nos?.find((phone) => phone.is_primary_mobile_no)?.phone ?? '',
        fax: '',
      })));
  }

  private getAddress(name: string): Observable<CustomerAddressData> {
    return this.http
      .get<{ data: CustomerAddressRecord }>(this.auth.apiUrl('/api/resource/Address/' + encodeURIComponent(name)), {
        withCredentials: true,
      })
      .pipe(map(({ data }) => ({
        address_type: data.address_type ?? 'Billing',
        address_line1: data.address_line1 ?? '',
        address_line2: data.address_line2 ?? '',
        city: data.city ?? '',
        state: data.state ?? '',
        pincode: data.pincode ?? '',
        country: data.country ?? '',
        fax: data.fax ?? '',
      })));
  }

  private saveLinkedRecords(
    customer: ErpNextCustomer,
    contact: CustomerContactData,
    address: CustomerAddressData,
    contactName: string,
    addressName: string,
  ): Observable<ErpNextCustomer> {
    return this.saveContact(customer.name, contact, contactName).pipe(
      switchMap((savedContactName) => this.saveAddress(customer.name, address, addressName).pipe(
        map((savedAddressName) => ({ savedContactName, savedAddressName })),
      )),
      switchMap(({ savedContactName, savedAddressName }) => {
        const links: Record<string, string> = {};
        if (savedContactName && savedContactName !== contactName) {
          links['customer_primary_contact'] = savedContactName;
        }
        if (savedAddressName && savedAddressName !== addressName) {
          links['customer_primary_address'] = savedAddressName;
        }
        if (!Object.keys(links).length) {
          return of(customer);
        }
        return this.http
          .put<{ data: ErpNextCustomer }>(
            this.auth.apiUrl('/api/resource/Customer/' + encodeURIComponent(customer.name)),
            links,
            { withCredentials: true },
          )
          .pipe(map((response) => response.data));
      }),
    );
  }

  private saveContact(customerName: string, contact: CustomerContactData, contactName: string): Observable<string> {
    const hasContact = Object.values(contact).some((value) => value.trim());
    if (!hasContact) {
      return of(contactName);
    }

    const phoneNumbers = [
      ...(contact.business_phone.trim() ? [{ phone: contact.business_phone.trim(), is_primary_phone: 1 as const }] : []),
      ...(contact.home_phone.trim() ? [{ phone: contact.home_phone.trim() }] : []),
      ...(contact.mobile_phone.trim() ? [{ phone: contact.mobile_phone.trim(), is_primary_mobile_no: 1 as const }] : []),
    ];
    const payload = {
      first_name: contact.first_name.trim() || contact.email.trim() || 'Customer contact',
      last_name: contact.last_name.trim(),
      email_ids: contact.email.trim() ? [{ email_id: contact.email.trim(), is_primary: 1 }] : [],
      phone_nos: phoneNumbers,
      links: [{ link_doctype: 'Customer', link_name: customerName }],
      is_primary_contact: 1,
    };

    if (contactName) {
      return this.http
        .put(this.auth.apiUrl('/api/resource/Contact/' + encodeURIComponent(contactName)), payload, { withCredentials: true })
        .pipe(map(() => contactName));
    }
    return this.http
      .post<{ data: { name: string } }>(this.auth.apiUrl('/api/resource/Contact'), payload, { withCredentials: true })
      .pipe(map((response) => response.data.name));
  }

  private saveAddress(customerName: string, address: CustomerAddressData, addressName: string): Observable<string> {
    if (!address.address_line1.trim() || !address.city.trim() || !address.country.trim()) {
      return of(addressName);
    }

    const payload = {
      address_title: customerName,
      address_type: address.address_type,
      address_line1: address.address_line1.trim(),
      address_line2: address.address_line2.trim(),
      city: address.city.trim(),
      state: address.state.trim(),
      pincode: address.pincode.trim(),
      country: address.country,
      fax: address.fax.trim(),
      links: [{ link_doctype: 'Customer', link_name: customerName }],
      is_primary_address: 1,
    };

    if (addressName) {
      return this.http
        .put(this.auth.apiUrl('/api/resource/Address/' + encodeURIComponent(addressName)), payload, { withCredentials: true })
        .pipe(map(() => addressName));
    }
    return this.http
      .post<{ data: { name: string } }>(this.auth.apiUrl('/api/resource/Address'), payload, { withCredentials: true })
      .pipe(map((response) => response.data.name));
  }

  private emptyContact(): CustomerContactData {
    return { first_name: '', last_name: '', email: '', business_phone: '', home_phone: '', mobile_phone: '', fax: '' };
  }

  private emptyAddress(): CustomerAddressData {
    return { address_type: 'Billing', address_line1: '', address_line2: '', city: '', state: '', pincode: '', country: '', fax: '' };
  }

  private listNames(doctype: string, filters: unknown[][] = []): Observable<string[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(
        map((response) => (response.data ?? []).map((row) => row.name)),
        catchError(() => of([])),
      );
  }
}