import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SupabaseService } from './supabase.service';
import { CustomerAuthService } from './customer-auth.service';
import { CustomerDbService, LocalOrder } from './customer-db.service';

export interface CartItem {
  productId: number;
  productName: string;
  variantName?: string;
  selectedToppings?: any[];
  basePrice: number;
  price: number;
  qty: number;
  qtyPerItem?: number;
  subtotal: number;
  maxStock?: number;
  photo?: string;
  notes?: string;
}

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private supabaseService = inject(SupabaseService);
  private authService = inject(CustomerAuthService);
  private dbService = inject(CustomerDbService);

  private cartItemsSubject = new BehaviorSubject<CartItem[]>([]);
  public cartItems$ = this.cartItemsSubject.asObservable();

  private orderTypeSubject = new BehaviorSubject<'take_away' | 'delivery'>('take_away');
  public orderType$ = this.orderTypeSubject.asObservable();

  constructor() {
    this.loadCartFromStorage();
  }

  private loadCartFromStorage() {
    const saved = localStorage.getItem('customer_cart');
    if (saved) {
      try {
        this.cartItemsSubject.next(JSON.parse(saved));
      } catch {
        localStorage.removeItem('customer_cart');
      }
    }
  }

  private saveCartToStorage(items: CartItem[]) {
    localStorage.setItem('customer_cart', JSON.stringify(items));
    this.cartItemsSubject.next(items);
  }

  // Recursive Virtual Stock Calculator matching Cashier POS logic
  public calculateVirtualStock(p: any, allProducts: any[]): number {
    if (p.is_bundle || (!p.is_raw_material && p.components && p.components.length > 0)) {
      if (!p.components || p.components.length === 0) return 0;
      let minSets = Infinity;
      for (const comp of p.components) {
        const cp = allProducts.find(x => x.id === comp.productId);
        if (cp) {
          const compStock = this.calculateVirtualStock(cp, allProducts);
          const possible = Math.floor(compStock / comp.qty);
          if (possible < minSets) minSets = possible;
        } else {
          return 0; // Component not found
        }
      }
      return minSets === Infinity ? 0 : minSets;
    }
    return p.stock || 0;
  }

  // Fetch Menu from Supabase and calculate virtual stock from raw materials
  async getMenuProducts(): Promise<any[]> {
    const supabase = this.supabaseService.supabase;
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');

    if (error) throw error;
    const allProducts = data || [];

    // Map each sellable product with its calculated real-time virtual stock
    const sellableProducts = allProducts
      .filter(p => !p.is_raw_material)
      .map(p => {
        const virtualStock = this.calculateVirtualStock(p, allProducts);
        return {
          ...p,
          virtualStock,
          stock: virtualStock
        };
      });

    return sellableProducts;
  }

  // Cart Management
  get cart(): CartItem[] {
    return this.cartItemsSubject.value;
  }

  get cartCount(): number {
    return this.cart.reduce((sum, item) => sum + item.qty, 0);
  }

  get cartSubtotal(): number {
    return this.cart.reduce((sum, item) => sum + item.subtotal, 0);
  }

  addToCart(item: CartItem) {
    const current = [...this.cart];
    const existingIndex = current.findIndex(x => 
      x.productId === item.productId && 
      x.variantName === item.variantName && 
      JSON.stringify(x.selectedToppings) === JSON.stringify(item.selectedToppings)
    );

    const maxStock = item.maxStock !== undefined ? item.maxStock : 999;

    if (existingIndex > -1) {
      const newQty = Math.min(current[existingIndex].qty + item.qty, maxStock);
      current[existingIndex].qty = newQty;
      current[existingIndex].subtotal = newQty * current[existingIndex].price;
      current[existingIndex].maxStock = maxStock;
    } else {
      const clampedQty = Math.min(item.qty, maxStock);
      current.push({
        ...item,
        qty: clampedQty,
        subtotal: clampedQty * item.price,
        maxStock
      });
    }

    this.saveCartToStorage(current);
  }

  updateQty(index: number, newQty: number) {
    const current = [...this.cart];
    if (newQty <= 0) {
      current.splice(index, 1);
    } else {
      const maxStock = current[index].maxStock !== undefined ? current[index].maxStock : 999;
      const finalQty = Math.min(newQty, maxStock);
      current[index].qty = finalQty;
      current[index].subtotal = finalQty * current[index].price;
    }
    this.saveCartToStorage(current);
  }

  removeFromCart(index: number) {
    const current = [...this.cart];
    current.splice(index, 1);
    this.saveCartToStorage(current);
  }

  clearCart() {
    this.saveCartToStorage([]);
  }

  setOrderType(type: 'take_away' | 'delivery') {
    this.orderTypeSubject.next(type);
  }

  // Create Order / Checkout
  async placeOrder(paymentMethod: 'midtrans' | 'cash', customerInfo: { name: string; phone: string; email?: string }): Promise<LocalOrder> {
    if (this.cart.length === 0) {
      throw new Error('Keranjang belanja kosong');
    }

    const supabase = this.supabaseService.supabase;
    const currentUser = this.authService.currentUser;
    const isGuest = !this.authService.isLoggedIn;

    const trxCode = this.generateTrxCode();
    const queueNumber = await this.getNextQueueNumber();
    const total = this.cartSubtotal;
    const orderDate = new Date();

    const formattedItems = this.cart.map(c => ({
      productId: c.productId,
      productName: c.productName,
      variantName: c.variantName || null,
      selectedToppings: c.selectedToppings || [],
      price: c.price,
      basePrice: c.basePrice,
      qty: c.qty,
      qtyPerItem: c.qtyPerItem || 1,
      subtotal: c.subtotal,
      notes: c.notes || ''
    }));

    // 1. Send Order to Supabase Transactions
    const initialStatus = paymentMethod === 'midtrans' ? 'unpaid' : 'pending';
    const supabasePayload: any = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      trx_code: trxCode,
      queue_number: queueNumber,
      date: orderDate.toISOString(),
      total,
      cashier: 'Online Customer',
      items: formattedItems,
      payment_method: paymentMethod,
      received_amount: 0,
      change_amount: 0,
      customer_id: !isGuest && currentUser ? currentUser.id : null,
      customer_name: customerInfo.name,
      customer_phone: customerInfo.phone,
      customer_email: customerInfo.email || null,
      order_type: this.orderTypeSubject.value,
      status: initialStatus
    };

    const { data, error } = await supabase
      .from('transactions')
      .insert(supabasePayload)
      .select()
      .single();

    if (error) {
      console.error('Supabase order insert error:', error);
      throw new Error('Gagal mengirim pesanan ke kasir: ' + (error.message || 'Koneksi error'));
    }

    // 2. Immediately reduce stock in Supabase products / raw materials
    await this.reduceSupabaseStock(formattedItems);

    // 3. Save Order to Local Dexie DB
    const localOrder: LocalOrder = {
      trxCode,
      queueNumber,
      date: orderDate,
      total,
      items: formattedItems,
      paymentMethod,
      customerName: customerInfo.name,
      customerPhone: customerInfo.phone,
      orderType: this.orderTypeSubject.value,
      status: initialStatus,
      isGuest
    };

    await this.dbService.saveLocalOrder(localOrder);

    // 4. Clear Cart
    this.clearCart();

    return localOrder;
  }

  // Helper to reduce stock in Supabase directly
  private async reduceSupabaseStock(items: any[]) {
    try {
      const supabase = this.supabaseService.supabase;
      const { data: allProducts, error } = await supabase.from('products').select('*');
      if (error || !allProducts) return;

      const modifiedMap = new Map<number, number>();

      const reduceStockRecursive = (p: any, qty: number, qtyMultiplier: number = 1, customBundleComponents?: any[], variantName?: string) => {
        const componentsToUse = (p.is_bundle && customBundleComponents) ? customBundleComponents : (p.components || []);

        if (p.is_bundle || (!p.is_raw_material && componentsToUse && componentsToUse.length > 0)) {
          if (!componentsToUse || componentsToUse.length === 0) return;
          for (const comp of componentsToUse) {
            const depProduct = allProducts.find((x: any) => x.id === comp.productId);
            if (depProduct) {
              const neededPerUnit = (p.is_bundle && customBundleComponents) ? comp.qty : (qtyMultiplier * comp.qty);
              reduceStockRecursive(depProduct, qty * neededPerUnit, 1);
            }
          }
        } else {
          const currentStock = modifiedMap.has(p.id) ? modifiedMap.get(p.id)! : (p.stock || 0);
          const totalToReduce = qty * qtyMultiplier;
          const newStock = Math.max(0, currentStock - totalToReduce);
          modifiedMap.set(p.id, newStock);
        }

        // Container
        let cId = p.container_id || p.containerId;
        if (variantName && p.variants) {
          const v = p.variants.find((v: any) => v.name === variantName);
          if (v && (v.containerId || v.container_id)) {
            cId = v.containerId || v.container_id;
          }
        }
        if (cId && cId !== p.id) {
          const containerProduct = allProducts.find((x: any) => x.id === cId);
          if (containerProduct) {
            reduceStockRecursive(containerProduct, qty, 1);
          }
        }
      };

      for (const item of items) {
        const product = allProducts.find((x: any) => x.id === item.productId);
        if (product) {
          let qtyPerItem = item.qtyPerItem;
          if (!qtyPerItem && item.variantName && product.variants) {
            const v = product.variants.find((x: any) => x.name === item.variantName);
            if (v) qtyPerItem = v.qtyPerItem || v.qty_per_item || 1;
          }
          reduceStockRecursive(product, item.qty, qtyPerItem || 1, item.bundleComponents, item.variantName);
        }
      }

      for (const [pid, newStock] of modifiedMap.entries()) {
        await supabase.from('products').update({ stock: newStock }).eq('id', pid);
      }
    } catch (e) {
      console.warn('Error reducing stock in Supabase:', e);
    }
  }

  // Helper to restore stock in Supabase directly
  private async restoreSupabaseStock(items: any[]) {
    try {
      const supabase = this.supabaseService.supabase;
      const { data: allProducts, error } = await supabase.from('products').select('*');
      if (error || !allProducts) return;

      const modifiedMap = new Map<number, number>();

      const restoreStockRecursive = (p: any, qty: number, qtyMultiplier: number = 1, customBundleComponents?: any[], variantName?: string) => {
        const componentsToUse = (p.is_bundle && customBundleComponents) ? customBundleComponents : (p.components || []);

        if (p.is_bundle || (!p.is_raw_material && componentsToUse && componentsToUse.length > 0)) {
          if (!componentsToUse || componentsToUse.length === 0) return;
          for (const comp of componentsToUse) {
            const depProduct = allProducts.find((x: any) => x.id === comp.productId);
            if (depProduct) {
              const neededPerUnit = (p.is_bundle && customBundleComponents) ? comp.qty : (qtyMultiplier * comp.qty);
              restoreStockRecursive(depProduct, qty * neededPerUnit, 1);
            }
          }
        } else {
          const currentStock = modifiedMap.has(p.id) ? modifiedMap.get(p.id)! : (p.stock || 0);
          const totalToRestore = qty * qtyMultiplier;
          const newStock = currentStock + totalToRestore;
          modifiedMap.set(p.id, newStock);
        }

        // Container
        let cId = p.container_id || p.containerId;
        if (variantName && p.variants) {
          const v = p.variants.find((v: any) => v.name === variantName);
          if (v && (v.containerId || v.container_id)) {
            cId = v.containerId || v.container_id;
          }
        }
        if (cId && cId !== p.id) {
          const containerProduct = allProducts.find((x: any) => x.id === cId);
          if (containerProduct) {
            restoreStockRecursive(containerProduct, qty, 1);
          }
        }
      };

      for (const item of items) {
        const product = allProducts.find((x: any) => x.id === item.productId);
        if (product) {
          let qtyPerItem = item.qtyPerItem;
          if (!qtyPerItem && item.variantName && product.variants) {
            const v = product.variants.find((x: any) => x.name === item.variantName);
            if (v) qtyPerItem = v.qtyPerItem || v.qty_per_item || 1;
          }
          restoreStockRecursive(product, item.qty, qtyPerItem || 1, item.bundleComponents, item.variantName);
        }
      }

      for (const [pid, newStock] of modifiedMap.entries()) {
        await supabase.from('products').update({ stock: newStock }).eq('id', pid);
      }
    } catch (e) {
      console.warn('Error restoring stock in Supabase:', e);
    }
  }

  async updateOrderPaymentSuccess(trxCode: string, total: number) {
    try {
      const supabase = this.supabaseService.supabase;
      await supabase
        .from('transactions')
        .update({
          status: 'pending',
          received_amount: total
        })
        .eq('trx_code', trxCode);

      await this.dbService.updateOrderStatus(trxCode, 'pending');
    } catch (e) {
      console.warn('Error updating payment success status:', e);
    }
  }

  async cancelOrder(trxCode: string) {
    try {
      const supabase = this.supabaseService.supabase;
      const { data: trx } = await supabase
        .from('transactions')
        .select('*')
        .eq('trx_code', trxCode)
        .maybeSingle();

      if (trx && trx.status !== 'cancelled') {
        if (trx.items && trx.items.length > 0) {
          await this.restoreSupabaseStock(trx.items);
        }

        await supabase
          .from('transactions')
          .update({ status: 'cancelled' })
          .eq('trx_code', trxCode);

        await this.dbService.updateOrderStatus(trxCode, 'cancelled');
      }
    } catch (e) {
      console.warn('Error cancelling order:', e);
    }
  }

  // Fetch Order History for User
  async getOrderHistory(): Promise<LocalOrder[]> {
    const isGuest = !this.authService.isLoggedIn;
    const currentUser = this.authService.currentUser;

    if (isGuest) {
      // Guest: fetch strictly from local Dexie database
      return this.dbService.getLocalOrders();
    } else if (currentUser && currentUser.id) {
      // Registered: fetch from Supabase and cache locally
      try {
        const supabase = this.supabaseService.supabase;
        const { data, error } = await supabase
          .from('transactions')
          .select('*')
          .eq('customer_id', currentUser.id)
          .order('date', { ascending: false });

        if (error) throw error;

        if (data && data.length > 0) {
          const mapped: LocalOrder[] = data.map(d => ({
            trxCode: d.trx_code,
            queueNumber: d.queue_number,
            date: new Date(d.date),
            total: d.total,
            items: d.items || [],
            paymentMethod: d.payment_method,
            customerName: d.customer_name,
            customerPhone: d.customer_phone,
            orderType: d.order_type || 'take_away',
            status: d.status || 'completed',
            isGuest: false
          }));
          return mapped;
        }
      } catch (e) {
        console.warn('Fallback to local orders:', e);
      }
      return this.dbService.getLocalOrders();
    }

    return this.dbService.getLocalOrders();
  }

  private generateTrxCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'ORD-';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async getNextQueueNumber(): Promise<number> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const supabase = this.supabaseService.supabase;
      const { count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', today.toISOString());

      return (count || 0) + 1;
    } catch {
      return Math.floor(Math.random() * 90) + 10;
    }
  }
}
