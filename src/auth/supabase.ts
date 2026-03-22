import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://qsfziivubwdgtmwyztfw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzZnppaXZ1YndkZ3Rtd3l6dGZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MDY5NzYsImV4cCI6MjA4ODA4Mjk3Nn0.-yTPPDrZHE26FtmHVzsuR4qSMNJdQtmx8mYA_bkQ6ZE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
