import { Alert } from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { api } from '../api/client';

type BillingOrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  courseName?: string;
  orderKind?: string;
};

/** One-time Razorpay checkout for subscription / renewal / combo packages. */
export async function payBillingPackage(params: {
  billingPackageId: number;
  userEmail: string;
  userName: string;
  userMobileDigits?: string;
  checkoutTitle?: string;
}) {
  const { billingPackageId, userEmail, userName, userMobileDigits, checkoutTitle } = params;

  const order = (await api.post('/payments/razorpay/create-billing-order', {
    billing_package_id: billingPackageId,
  })) as BillingOrderResponse;

  const checkoutOptions = {
    description: checkoutTitle || order.courseName || 'EngLeash Academy',
    currency: order.currency || 'INR',
    key: order.keyId,
    amount: String(order.amount),
    order_id: order.orderId,
    name: order.courseName || 'EngLeash Academy',
    prefill: {
      email: userEmail || 'student@example.com',
      contact: (userMobileDigits || '').replace(/\D/g, '').slice(-10) || undefined,
      name: userName || 'Student',
    },
    theme: { color: '#1a237e' },
  };

  try {
    const paymentData = await RazorpayCheckout.open(checkoutOptions as any);
    await api.post('/payments/razorpay/verify', {
      razorpay_order_id: paymentData.razorpay_order_id,
      razorpay_payment_id: paymentData.razorpay_payment_id,
      razorpay_signature: paymentData.razorpay_signature,
    });
    return true;
  } catch (e: any) {
    const code = e?.error?.code ?? e?.code;
    const desc = String(e?.error?.description || e?.description || e?.message || '').toLowerCase();
    const userDismissed =
      code === 2 ||
      code === 'USER_CANCELLED' ||
      desc.includes('cancel') ||
      desc.includes('dismiss') ||
      desc.includes('closed') ||
      desc.includes('back');
    if (userDismissed) return false;
    throw new Error(e?.error?.description || e?.message || 'Payment failed');
  }
}

export function alertBillingPaymentError(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Payment could not be completed';
  Alert.alert('Payment', msg);
}
