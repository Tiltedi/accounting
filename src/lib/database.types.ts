// Generated from the Supabase project schema. Regenerate after schema changes.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      documents: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          currency: string | null
          description: string | null
          doc_date: string
          doc_type: string | null
          extraction: Json | null
          file_name: string
          file_path: string
          id: string
          invoice_number: string | null
          mime_type: string
          notes: string | null
          search: string | null
          sha256: string | null
          size_bytes: number
          status: string
          tax: number | null
          total: number | null
          vendor: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          doc_date?: string
          doc_type?: string | null
          extraction?: Json | null
          file_name: string
          file_path: string
          id?: string
          invoice_number?: string | null
          mime_type: string
          notes?: string | null
          search?: string | null
          sha256?: string | null
          size_bytes: number
          status?: string
          tax?: number | null
          total?: number | null
          vendor?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string | null
          description?: string | null
          doc_date?: string
          doc_type?: string | null
          extraction?: Json | null
          file_name?: string
          file_path?: string
          id?: string
          invoice_number?: string | null
          mime_type?: string
          notes?: string | null
          search?: string | null
          sha256?: string | null
          size_bytes?: number
          status?: string
          tax?: number | null
          total?: number | null
          vendor?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
