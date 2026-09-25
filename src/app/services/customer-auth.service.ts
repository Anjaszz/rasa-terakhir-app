import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { SupabaseService } from './supabase.service';

export interface CustomerUser {
  id?: string;
  name: string;
  whatsapp: string;
  email?: string;
  isGuest?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CustomerAuthService {
  private supabaseService = inject(SupabaseService);

  private currentUserSubject = new BehaviorSubject<CustomerUser | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor() {
    this.loadSavedSession();
  }

  private loadSavedSession() {
    const saved = localStorage.getItem('customer_user');
    if (saved) {
      try {
        this.currentUserSubject.next(JSON.parse(saved));
      } catch (e) {
        localStorage.removeItem('customer_user');
      }
    }
  }

  get currentUser(): CustomerUser | null {
    return this.currentUserSubject.value;
  }

  get isLoggedIn(): boolean {
    const user = this.currentUser;
    return !!(user && !user.isGuest && user.id);
  }

  // Set guest details (Name, Whatsapp, optional Email)
  setGuestUser(name: string, whatsapp: string, email?: string) {
    const guestUser: CustomerUser = {
      name,
      whatsapp,
      email,
      isGuest: true
    };
    localStorage.setItem('customer_user', JSON.stringify(guestUser));
    this.currentUserSubject.next(guestUser);
    return guestUser;
  }

  // Register Customer User in Supabase
  async register(name: string, whatsapp: string, email?: string, password?: string) {
    const supabase = this.supabaseService.supabase;

    // Check if phone already registered
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('whatsapp', whatsapp)
      .maybeSingle();

    if (existing) {
      throw new Error('Nomor WhatsApp ini sudah terdaftar. Silakan login.');
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        name,
        whatsapp,
        email: email || null,
        password: password || '123456'
      })
      .select()
      .single();

    if (error) throw error;

    const user: CustomerUser = {
      id: data.id,
      name: data.name,
      whatsapp: data.whatsapp,
      email: data.email,
      isGuest: false
    };

    localStorage.setItem('customer_user', JSON.stringify(user));
    this.currentUserSubject.next(user);
    return user;
  }

  // Login Customer User with WhatsApp & Password
  async login(whatsapp: string, password?: string) {
    const supabase = this.supabaseService.supabase;

    const query = supabase
      .from('customers')
      .select('*')
      .eq('whatsapp', whatsapp);

    if (password) {
      query.eq('password', password);
    }

    const { data, error } = await query.maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error('Nomor WhatsApp atau password salah');
    }

    const user: CustomerUser = {
      id: data.id,
      name: data.name,
      whatsapp: data.whatsapp,
      email: data.email,
      isGuest: false
    };

    localStorage.setItem('customer_user', JSON.stringify(user));
    this.currentUserSubject.next(user);
    return user;
  }

  logout() {
    localStorage.removeItem('customer_user');
    this.currentUserSubject.next(null);
  }
}
