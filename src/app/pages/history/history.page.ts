import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { IonContent, IonHeader, IonIcon } from '@ionic/angular/standalone';
import { Subscription } from 'rxjs';
import { addIcons } from 'ionicons';
import { 
  receiptOutline, timeOutline, checkmarkCircle, 
  arrowForward, storefrontOutline, bagHandleOutline, sparkles
} from 'ionicons/icons';
import { OrderService } from '../../services/order.service';
import { CustomerAuthService } from '../../services/customer-auth.service';
import { CustomerDbService, LocalOrder } from '../../services/customer-db.service';
import { SupabaseService } from '../../services/supabase.service';
import { CustomerNotificationService } from '../../services/customer-notification.service';

@Component({
  selector: 'app-history',
  templateUrl: './history.page.html',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, CommonModule, RouterModule]
})
export class HistoryPage implements OnInit, OnDestroy {
  public orderService = inject(OrderService);
  public authService = inject(CustomerAuthService);
  private dbService = inject(CustomerDbService);
  private supabaseService = inject(SupabaseService);
  private notificationService = inject(CustomerNotificationService);

  orders: LocalOrder[] = [];
  filteredOrders: LocalOrder[] = [];
  selectedFilter: 'all' | 'unpaid' | 'processing' | 'ready' | 'completed' | 'cancelled' = 'all';
  isLoading = true;

  private statusSub?: Subscription;

  constructor() {
    addIcons({ 
      receiptOutline, timeOutline, checkmarkCircle, 
      arrowForward, storefrontOutline, bagHandleOutline, sparkles 
    });
  }

  ngOnInit() {
    this.loadHistory();
    this.statusSub = this.notificationService.orderStatusChanged$.subscribe((updated) => {
      if (updated) {
        this.loadHistory(false);
      }
    });
  }

  ngOnDestroy() {
    this.statusSub?.unsubscribe();
  }

  ionViewWillEnter() {
    this.loadHistory(false);
  }

  async loadHistory(showLoading = true) {
    if (showLoading) this.isLoading = true;
    try {
      this.orders = await this.orderService.getOrderHistory();

      // Refresh latest statuses from Supabase for local orders
      const codes = this.orders.map(o => o.trxCode);
      if (codes.length > 0) {
        try {
          const { data } = await this.supabaseService.supabase
            .from('transactions')
            .select('trx_code, status')
            .in('trx_code', codes);

          if (data) {
            for (const item of data) {
              const matched = this.orders.find(o => o.trxCode === item.trx_code);
              if (matched && matched.status !== item.status) {
                matched.status = item.status;
                await this.dbService.updateOrderStatus(item.trx_code, item.status);
              }
            }
          }
        } catch (e) {
          console.warn('Could not refresh remote order status:', e);
        }
      }

      this.applyFilter();
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      this.isLoading = false;
    }
  }

  applyFilter() {
    if (this.selectedFilter === 'all') {
      this.filteredOrders = [...this.orders];
    } else if (this.selectedFilter === 'processing') {
      // Group both 'pending' and 'processing' in 'Diproses' tab for customer
      this.filteredOrders = this.orders.filter(o => o.status === 'processing' || o.status === 'pending');
    } else {
      this.filteredOrders = this.orders.filter(o => o.status === this.selectedFilter);
    }
  }

  setFilter(filter: 'all' | 'unpaid' | 'processing' | 'ready' | 'completed' | 'cancelled') {
    this.selectedFilter = filter;
    this.applyFilter();
  }

  formatRupiah(val: number): string {
    return 'Rp ' + (val || 0).toLocaleString('id-ID');
  }
}
