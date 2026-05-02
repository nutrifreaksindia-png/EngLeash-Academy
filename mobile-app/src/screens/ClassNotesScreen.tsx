import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenPageTitle } from '../components/ScreenPageTitle';

const BRAND_RED = '#c41e3a';

type Note = { id: number; title: string; fileUrl: string };

export default function ClassNotesScreen({ route, navigation }: any) {
  const { notes } = route.params as { notes: Note[] };

  const openPdf = (url: string) => {
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={styles.pageRoot}>
      <ScreenPageTitle title="Class notes" />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>Tap to view or download (opens in browser)</Text>
      {notes.map((n) => (
        <TouchableOpacity key={n.id} style={styles.card} onPress={() => openPdf(n.fileUrl)}>
          <Text style={styles.cardTitle}>{n.title}</Text>
          <Text style={styles.cardSub}>View / Download PDF</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: BRAND_RED,
  },
  cardTitle: { fontSize: 17, fontWeight: '600', color: '#333' },
  cardSub: { fontSize: 14, color: '#666', marginTop: 4 },
  backBtn: {
    marginTop: 24,
    backgroundColor: BRAND_RED,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  backBtnText: { color: '#fff', fontWeight: '600' },
});
