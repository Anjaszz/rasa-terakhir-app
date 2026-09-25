import { Injectable } from '@angular/core';
import Dexie, { Table } from 'dexie';

export interface LocalOrder {
  id?: number;
  trxCode: string;
  queueNumber: number;
  date: Date;
  total: number;
  items: any[];
  paymentMethod: string;
  customerName: string;
  customerPhone: string;
  orderType: string;
  status: string;
  isGuest: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CustomerDbService extends Dexie {
  guestOrders!: Table<LocalOrder, number>;

  constructor() {
    super('CustomerAppDatabase');
    this.version(1).stores({
      guestOrders: '++id, trxCode, date, customerPhone, status'
    });
  }

  async saveLocalOrder(order: LocalOrder) {
    return this.guestOrders.add(order);
  }

  async getLocalOrders() {
    return this.guestOrders.reverse().sortBy('date');
  }

  async getLocalOrderByCode(trxCode: string) {
    return this.guestOrders.where('trxCode').equals(trxCode).first();
  }

  async updateOrderStatus(trxCode: string, status: string): Promise<number> {
    const order = await this.getLocalOrderByCode(trxCode);
    if (order && order.id) {
      return this.guestOrders.update(order.id, { status });
    }
    return 0;
  }
}
