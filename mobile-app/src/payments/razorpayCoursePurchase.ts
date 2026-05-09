import { Alert } from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import { api } from '../api/client';

type CreateOrderResponse = {
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  courseName?: string;
};

/** Opens Razorpay Checkout for a course purchase; verifies payment server-side. */
export async function purchaseCourseWithRazorpay(params: {
  courseId: number;
  courseDisplayName: string;
  userEmail: string;
  userName: string;
  userMobileDigits?: string;
}) {
  const { courseId, courseDisplayName, userEmail, userName, userMobileDigits } = params;

  const order = (await api.post('/payments/razorpay/create-order', {
    course_id: courseId,
  })) as CreateOrderResponse;

  const checkoutOptions = {
    description: courseDisplayName,
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

export function alertPurchaseError(err: unknown) {
  const msg = err instanceof Error ? err.message : 'Payment could not be completed';
  Alert.alert('Payment', msg);
}
