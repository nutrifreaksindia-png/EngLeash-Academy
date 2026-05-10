import React from 'react';
import { Alert, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

const BRAND_BLUE = '#1a237e';
/** Match @react-navigation/native-stack default header body height (sans status bar). */
const HEADER_ROW_H = Platform.OS === 'ios' ? 44 : 56;

function onNotificationsPress() {
  Alert.alert('Notifications', 'You have no new notifications yet.');
}

/**
 * Custom bar aligned with `appStackScreenOptions` (logo offset, title, bell) and native header row height.
 */
export function BrandedTopBar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={[styles.toolbar, { minHeight: HEADER_ROW_H }]}>
        <View style={styles.leftRow}>
          <View style={styles.logoWrap} accessibilityLabel="EngLeash Academy logo">
            <Image
              source={require('../../../brand/logo_icon.png')}
              style={styles.logo}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
            />
          </View>
          <View style={styles.titleBlock} accessibilityRole="header">
            <Text style={styles.brandLine} numberOfLines={1}>
              EngLeash Academy
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={onNotificationsPress}
          style={styles.notifyBtn}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="notifications-outline" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: BRAND_BLUE,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  leftRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  logoWrap: {
    justifyContent: 'center',
    marginRight: 16,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  titleBlock: {
    flex: 1,
    justifyContent: 'center',
    maxWidth: '88%',
    paddingRight: 8,
  },
  brandLine: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  notifyBtn: {
    marginRight: 14,
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
