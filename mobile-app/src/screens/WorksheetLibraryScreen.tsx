import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';
import { ContentBlocksView, parseContentBlocks } from '../components/learn/ContentBlocksView';
import { api } from '../api/client';

const BRAND_RED = '#c41e3a';

type WorksheetLibraryData = {
  id: number;
  title: string;
  description?: string | null;
  content_json: string;
};

export default function WorksheetLibraryScreen({ route }: any) {
  const { worksheetId, worksheetTitle } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WorksheetLibraryData | null>(null);

  useEffect(() => {
    api.get(`/worksheets/${worksheetId}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [worksheetId]);

  const blocks = useMemo(() => parseContentBlocks(data?.content_json || ''), [data]);

  if (loading) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={worksheetTitle || 'Worksheet'} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BRAND_RED} />
        </View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.pageRoot}>
        <ScreenPageTitle title={worksheetTitle || 'Worksheet'} />
        <View style={styles.centered}>
          <Text style={styles.error}>Failed to load worksheet.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title={data.title || worksheetTitle || 'Worksheet'} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        <ContentBlocksView
          blocks={blocks}
          description={data.description}
          scrollable={false}
          horizontalInset={32}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  scrollContent: { flexGrow: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  error: { color: '#c62828', fontSize: 16 },
});
