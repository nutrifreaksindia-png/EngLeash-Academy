import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

const BRAND_BLUE = '#1a237e';

type Props = {
  title: string;
  style?: ViewStyle;
  /** When false, omit the bottom hairline (e.g. when wrapped in another bordered container). */
  showDivider?: boolean;
};

export function ScreenPageTitle({ title, style, showDivider = true }: Props) {
  if (!title) return null;
  return (
    <View style={[styles.wrap, showDivider && styles.wrapDivider, style]} accessibilityRole="header">
      <Text style={styles.text}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  wrapDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#c5c5c5',
  },
  text: {
    fontSize: 18,
    fontWeight: '700',
    color: BRAND_BLUE,
  },
});
