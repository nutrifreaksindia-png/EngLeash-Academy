import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

type Props = {
  children: ReactNode;
  onGoBack: () => void;
};

type State = {
  error: Error | null;
};

/**
 * Surfaces render/lifecycle errors in Metro (console.error) and on-screen instead of the generic Expo dev-client shell.
 */
export class LiveClassroomErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const msg = error?.message ?? String(error);
    const stack = error?.stack ?? '';
    const comp = info?.componentStack ?? '';
    // Metro shows console.error — copy this block when reporting issues.
    console.error('[EngLeash LiveClassroom] render error:', msg, '\n', stack, '\ncomponentStack:', comp);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.root}>
          <Text style={styles.title}>Live classroom crashed (JS)</Text>
          <Text style={styles.hint}>
            The message below is also printed in Metro / terminal as{' '}
            <Text style={styles.mono}>[EngLeash LiveClassroom]</Text>.
          </Text>
          <Text selectable style={styles.monoBlock}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack ?? ''}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={this.props.onGoBack} accessibilityRole="button">
            <Text style={styles.btnText}>Go back</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#f5f5f5' },
  title: { fontSize: 18, fontWeight: '800', color: '#1a237e', marginBottom: 10 },
  hint: { fontSize: 13, color: '#444', marginBottom: 12 },
  mono: { fontFamily: 'Courier' },
  monoBlock: { fontSize: 11, fontFamily: 'Courier', color: '#111', backgroundColor: '#fff', padding: 12, borderRadius: 8 },
  btn: { marginTop: 16, backgroundColor: '#c41e3a', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
