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
      bank_rules: {
        Row: {
          created_at: string
          exact: boolean
          field: string
          id: string
          label: string | null
          pattern: string
        }
        Insert: {
          created_at?: string
          exact?: boolean
          field: string
          id?: string
          label?: string | null
          pattern: string
        }
        Update: {
          created_at?: string
          exact?: boolean
          field?: string
          id?: string
          label?: string | null
          pattern?: string
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          account: string | null
          amount: number
          bank_ref: string | null
          booked_on: string
          counterparty: string | null
          created_at: string
          currency: string
          description: string | null
          document_id: string | null
          fingerprint: string
          id: string
          import_id: string
          matched_by: string | null
          note: string | null
          source: string
          statement_id: string | null
          status: string
        }
        Insert: {
          account?: string | null
          amount: number
          bank_ref?: string | null
          booked_on: string
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          document_id?: string | null
          fingerprint: string
          id?: string
          import_id: string
          matched_by?: string | null
          note?: string | null
          source?: string
          statement_id?: string | null
          status?: string
        }
        Update: {
          account?: string | null
          amount?: number
          bank_ref?: string | null
          booked_on?: string
          counterparty?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          document_id?: string | null
          fingerprint?: string
          id?: string
          import_id?: string
          matched_by?: string | null
          note?: string | null
          source?: string
          statement_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          ai_cost_usd: number | null
          booked_at: string | null
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
          ai_cost_usd?: number | null
          booked_at?: string | null
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
          ai_cost_usd?: number | null
          booked_at?: string | null
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
      inbox_items: {
        Row: {
          attachments: Json
          created_at: string
          decided_at: string | null
          document_ids: string[]
          gmail_id: string
          id: string
          mailbox: string
          received_at: string
          sender: string | null
          snippet: string | null
          status: string
          subject: string | null
        }
        Insert: {
          attachments?: Json
          created_at?: string
          decided_at?: string | null
          document_ids?: string[]
          gmail_id: string
          id?: string
          mailbox: string
          received_at: string
          sender?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          attachments?: Json
          created_at?: string
          decided_at?: string | null
          document_ids?: string[]
          gmail_id?: string
          id?: string
          mailbox?: string
          received_at?: string
          sender?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      mail_connections: {
        Row: {
          created_at: string
          email: string
          id: string
          last_checked_at: string | null
          refresh_token: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          last_checked_at?: string | null
          refresh_token: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          last_checked_at?: string | null
          refresh_token?: string
        }
        Relationships: []
      }
      vendor_links: {
        Row: {
          created_at: string
          id: string
          pattern: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          pattern: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          pattern?: string
          url?: string
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
