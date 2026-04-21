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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      model_weights: {
        Row: {
          arima_w: number
          entropy_w: number
          hmm_w: number
          hurst_w: number
          id: string
          llm_w: number
          market: string
          recent_accuracy: number
          recent_brier: number
          samples: number
          symbol: string
          timeframe: string
          updated_at: string
        }
        Insert: {
          arima_w?: number
          entropy_w?: number
          hmm_w?: number
          hurst_w?: number
          id?: string
          llm_w?: number
          market: string
          recent_accuracy?: number
          recent_brier?: number
          samples?: number
          symbol: string
          timeframe: string
          updated_at?: string
        }
        Update: {
          arima_w?: number
          entropy_w?: number
          hmm_w?: number
          hurst_w?: number
          id?: string
          llm_w?: number
          market?: string
          recent_accuracy?: number
          recent_brier?: number
          samples?: number
          symbol?: string
          timeframe?: string
          updated_at?: string
        }
        Relationships: []
      }
      news_sentiment_cache: {
        Row: {
          bias: number
          cached_at: string
          id: string
          market: string
          published_at: string | null
          rationale: string | null
          sentiment: number
          source: string | null
          symbol: string
          title: string
          url_hash: string
        }
        Insert: {
          bias: number
          cached_at?: string
          id?: string
          market: string
          published_at?: string | null
          rationale?: string | null
          sentiment: number
          source?: string | null
          symbol: string
          title: string
          url_hash: string
        }
        Update: {
          bias?: number
          cached_at?: string
          id?: string
          market?: string
          published_at?: string | null
          rationale?: string | null
          sentiment?: number
          source?: string | null
          symbol?: string
          title?: string
          url_hash?: string
        }
        Relationships: []
      }
      prediction_outcomes: {
        Row: {
          abs_error: number
          actual_direction: string
          actual_price: number
          brier_score: number
          direction_correct: boolean
          id: string
          pct_error: number
          prediction_id: string
          resolved_at: string
        }
        Insert: {
          abs_error: number
          actual_direction: string
          actual_price: number
          brier_score: number
          direction_correct: boolean
          id?: string
          pct_error: number
          prediction_id: string
          resolved_at?: string
        }
        Update: {
          abs_error?: number
          actual_direction?: string
          actual_price?: number
          brier_score?: number
          direction_correct?: boolean
          id?: string
          pct_error?: number
          prediction_id?: string
          resolved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prediction_outcomes_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          created_at: string
          direction: string
          features: Json | null
          horizon_seconds: number
          hybrid_confidence: number
          id: string
          llm_bias: number | null
          market: string
          predicted_price: number
          resolves_at: string
          spot_price: number
          symbol: string
          timeframe: string
          weights: Json
        }
        Insert: {
          created_at?: string
          direction: string
          features?: Json | null
          horizon_seconds: number
          hybrid_confidence: number
          id?: string
          llm_bias?: number | null
          market: string
          predicted_price: number
          resolves_at: string
          spot_price: number
          symbol: string
          timeframe: string
          weights: Json
        }
        Update: {
          created_at?: string
          direction?: string
          features?: Json | null
          horizon_seconds?: number
          hybrid_confidence?: number
          id?: string
          llm_bias?: number | null
          market?: string
          predicted_price?: number
          resolves_at?: string
          spot_price?: number
          symbol?: string
          timeframe?: string
          weights?: Json
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

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
