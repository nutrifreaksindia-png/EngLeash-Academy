import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';

function stripHtml(html: string) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function AssignmentLibraryDetailScreen({ route }: any) {
  const { assignmentId, title: paramTitle } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState(paramTitle || 'Assignment');
  const [bodyText, setBodyText] = useState('');

  useEffect(() => {
    if (!assignmentId) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    api
      .get(`/assignments/${assignmentId}`)
      .then((row: any) => {
        if (cancelled || !row) return;
        setTitle(row.title || paramTitle || 'Assignment');
        setBodyText(stripHtml(row.content_html || ''));
      })
      .catch(() => {
        if (!cancelled) setBodyText('');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assignmentId, paramTitle]);

  if (loading) {
    return (
      <View style={styles.root}>
        <ScreenPageTitle title={title} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScreenPageTitle title={title} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {bodyText ? <Text style={styles.body}>{bodyText}</Text> : <Text style={styles.muted}>No instructions loaded.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f5f5' },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  body: { fontSize: 16, color: '#333', lineHeight: 24 },
  muted: { fontSize: 15, color: '#666' },
});
