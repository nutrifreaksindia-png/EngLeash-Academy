import { Alert } from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { api } from '../api/client';

type ApplyOrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  courseName?: string;
  paymentLabel?: string;
  dueItemId?: number;
  billingProfileId?: number;
};

type ApplyOrderParams =
  | {
      dueItemId: number;
      userEmail: string;
      userName: string;
      userMobileDigits?: string;
      checkoutTitle?: string;
    }
  | {
      courseId: number;
      batchId: number;
      selectedPlan: 'registration' | 'single_payment' | 'first_installment';
      userEmail: string;
      userName: string;
      userMobileDigits?: string;
      checkoutTitle?: string;
    };

export async function payApplyDueWithRazorpay(params: ApplyOrderParams) {
  const order = (await api.post(
    '/payments/razorpay/create-apply-order',
    'dueItemId' in params
      ? { due_item_id: params.dueItemId }
      : {
          course_id: params.courseId,
          batch_id: params.batchId,
          selected_plan: params.selectedPlan,
        },
  )) as ApplyOrderResponse;

  const checkoutOptions = {
    description: params.checkoutTitle || order.paymentLabel || order.courseName || 'EngLeash Academy',
    currency: order.currency || 'INR',
    key: order.keyId,
    amount: String(order.amount),
    order_id: order.orderId,
    name: order.courseName || 'EngLeash Academy',
    prefill: {
      email: params.userEmail || 'student@example.com',
      contact: (params.userMobileDigits || '').replace(/\D/g, '').slice(-10) || undefined,
      name: params.userName || 'Student',
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
    return {
      ok: true,
      dueItemId: order.dueItemId || null,
      billingProfileId: order.billingProfileId || null,
    };
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
    if (userDismissed) return { ok: false, cancelled: true };
    throw new Error(e?.error?.description || e?.message || 'Payment failed');
  }
}

export function alertApplyPaymentError(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Payment could not be completed';
  Alert.alert('Payment', msg);
}
