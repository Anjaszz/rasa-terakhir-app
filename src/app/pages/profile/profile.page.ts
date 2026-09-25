import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { IonContent, IonHeader, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  personOutline, person, mailOutline, logoWhatsapp, 
  lockClosedOutline, logInOutline, logOutOutline, sparkles, 
  checkmarkCircle, eyeOutline, eyeOffOutline
} from 'ionicons/icons';
import { CustomerAuthService, CustomerUser } from '../../services/customer-auth.service';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  standalone: true,
  imports: [IonContent, IonHeader, IonIcon, CommonModule, FormsModule, RouterModule]
})
export class ProfilePage implements OnInit {
  public authService = inject(CustomerAuthService);

  isRegisterMode = false;
  
  // Auth Form Fields
  name = '';
  whatsapp = '';
  email = '';
  password = '';
  showPassword = false;

  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor() {
    addIcons({
      personOutline, person, mailOutline, logoWhatsapp,
      lockClosedOutline, logInOutline, logOutOutline, sparkles,
      checkmarkCircle, eyeOutline, eyeOffOutline
    });
  }

  ngOnInit() {
  }

  toggleMode() {
    this.isRegisterMode = !this.isRegisterMode;
    this.errorMessage = '';
    this.successMessage = '';
  }

  async doAuth() {
    this.errorMessage = '';
    this.successMessage = '';

    if (!this.whatsapp.trim()) {
      this.errorMessage = 'Harap isi nomor WhatsApp';
      return;
    }

    if (!this.password.trim()) {
      this.errorMessage = 'Harap isi password';
      return;
    }

    this.isLoading = true;

    try {
      if (this.isRegisterMode) {
        if (!this.name.trim()) {
          throw new Error('Harap isi nama lengkap');
        }
        await this.authService.register(
          this.name.trim(),
          this.whatsapp.trim(),
          this.email.trim() || undefined,
          this.password.trim()
        );
        this.successMessage = 'Pendaftaran berhasil! Anda telah masuk.';
      } else {
        await this.authService.login(this.whatsapp.trim(), this.password.trim());
        this.successMessage = 'Berhasil masuk!';
      }
    } catch (e: any) {
      this.errorMessage = e?.message || 'Terjadi kesalahan saat proses login';
    } finally {
      this.isLoading = false;
    }
  }

  logout() {
    this.authService.logout();
    this.successMessage = 'Sesi telah ditutup.';
  }
}
