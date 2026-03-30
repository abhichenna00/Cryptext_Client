use std::sync::{Mutex, MutexGuard};

pub trait MutexExt<T> {
    fn lock_or_err(&self) -> Result<MutexGuard<'_, T>, String>;
}

impl<T> MutexExt<T> for Mutex<T> {
    fn lock_or_err(&self) -> Result<MutexGuard<'_, T>, String> {
        self.lock().map_err(|e| e.to_string())
    }
}
