import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { IonApp, IonRouterOutlet, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  restaurantOutline, restaurant, cartOutline, cart, 
  receiptOutline, receipt, personOutline, person,
  sparkles, checkmarkCircle
} from 'ionicons/icons';
import { OrderService } from './services/order.service';
import { CustomerNotificationService } from './services/customer-notification.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  standalone: true,
  imports: [IonApp, IonRouterOutlet, CommonModule, RouterModule, IonIcon]
})
export class AppComponent {
  public orderService = inject(OrderService);
  public notificationService = inject(CustomerNotificationService);
  public router = inject(Router);

  constructor() {
    addIcons({
      restaurantOutline, restaurant, cartOutline, cart,
      receiptOutline, receipt, personOutline, person,
      sparkles, checkmarkCircle
    });
  }

  isCurrentRoute(url: string): boolean {
    return this.router.url.startsWith(url);
  }
}
