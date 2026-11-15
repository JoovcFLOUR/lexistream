use serde::Serialize;
use std::{alloc::{alloc, dealloc, Layout}, slice, str};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WasmSubtitleToken {
    pub index: usize,
    pub text: String,
    pub is_word: bool,
    pub normalized: String,
    pub start_offset: usize,
    pub end_offset: usize,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

fn is_apostrophe(c: char) -> bool {
    c == '\'' || c == '’'
}

pub fn normalize_word_rust(raw: &str) -> String {
    raw.trim_matches(|c: char| !c.is_alphanumeric())
        .replace('’', "'")
        .to_lowercase()
}

/// Lossless single-pass Unicode subtitle tokenizer matching `@lexistream/language-core`.
pub fn tokenize_subtitle_rust(input: &str) -> Vec<WasmSubtitleToken> {
    if input.is_empty() {
        return Vec::new();
    }

    let chars: Vec<(usize, char)> = input.char_indices().collect();
    let n = chars.len();
    let mut tokens = Vec::with_capacity(n / 3 + 1);
    let mut i = 0usize;
    let mut token_index = 0usize;
    let mut utf16_offset = 0usize;

    while i < n {
        let (byte_start, ch) = chars[i];
        if is_word_char(ch) {
            let start_u16 = utf16_offset;
            utf16_offset += ch.len_utf16();
            i += 1;

            while i < n {
                let (_, c_next) = chars[i];
                if is_word_char(c_next) {
                    utf16_offset += c_next.len_utf16();
                    i += 1;
                } else if is_apostrophe(c_next) && i + 1 < n && is_word_char(chars[i + 1].1) {
                    utf16_offset += c_next.len_utf16();
                    utf16_offset += chars[i + 1].1.len_utf16();
                    i += 2;
                } else {
                    break;
                }
            }

            let byte_end = if i < n { chars[i].0 } else { input.len() };
            let slice_str = &input[byte_start..byte_end];
            tokens.push(WasmSubtitleToken {
                index: token_index,
                text: slice_str.to_string(),
                is_word: true,
                normalized: normalize_word_rust(slice_str),
                start_offset: start_u16,
                end_offset: utf16_offset,
            });
            token_index += 1;
        } else {
            let start_u16 = utf16_offset;
            utf16_offset += ch.len_utf16();
            i += 1;
            while i < n && !is_word_char(chars[i].1) {
                utf16_offset += chars[i].1.len_utf16();
                i += 1;
            }
            let byte_end = if i < n { chars[i].0 } else { input.len() };
            let slice_str = &input[byte_start..byte_end];
            tokens.push(WasmSubtitleToken {
                index: token_index,
                text: slice_str.to_string(),
                is_word: false,
                normalized: String::new(),
                start_offset: start_u16,
                end_offset: utf16_offset,
            });
            token_index += 1;
        }
    }

    tokens
}

pub fn count_normalized_words_rust(input: &str) -> usize {
    tokenize_subtitle_rust(input)
        .iter()
        .filter(|t| t.is_word)
        .count()
}

// --- Minimal WebAssembly C ABI exports (zero wasm-bindgen runtime overhead) ---

static mut LAST_RESULT_LEN: usize = 0;

#[no_mangle]
pub extern "C" fn wasm_alloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let Ok(layout) = Layout::from_size_align(size, 1) else {
        return std::ptr::null_mut();
    };
    // SAFETY: `size > 0` and alignment is 1. Caller checks null return.
    unsafe { alloc(layout) }
}

/// # Safety
/// `ptr` must have been allocated by `wasm_alloc` with the exact same `size`.
#[no_mangle]
pub unsafe extern "C" fn wasm_dealloc(ptr: *mut u8, size: usize) {
    if ptr.is_null() || size == 0 {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(size, 1) {
        // SAFETY: caller guarantees `ptr` and `size` match a prior `wasm_alloc` call.
        unsafe { dealloc(ptr, layout) };
    }
}

#[no_mangle]
pub extern "C" fn wasm_last_result_len() -> usize {
    // SAFETY: single-threaded WebAssembly instance state.
    unsafe { LAST_RESULT_LEN }
}

/// # Safety
/// `ptr` must point to `len` valid UTF-8 bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn wasm_tokenize_json(ptr: *const u8, len: usize) -> *mut u8 {
    if ptr.is_null() || len == 0 {
        // SAFETY: single-threaded WASM module.
        unsafe { LAST_RESULT_LEN = 0 };
        return std::ptr::null_mut();
    }
    // SAFETY: caller guarantees valid slice in linear memory.
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    let Ok(input) = str::from_utf8(bytes) else {
        // SAFETY: single-threaded WASM module.
        unsafe { LAST_RESULT_LEN = 0 };
        return std::ptr::null_mut();
    };

    let tokens = tokenize_subtitle_rust(input);
    let json_bytes = serde_json::to_vec(&tokens).unwrap_or_default();
    let out_len = json_bytes.len();
    let out_ptr = wasm_alloc(out_len);
    if !out_ptr.is_null() && out_len > 0 {
        // SAFETY: `out_ptr` is newly allocated with `out_len` bytes.
        unsafe {
            std::ptr::copy_nonoverlapping(json_bytes.as_ptr(), out_ptr, out_len);
            LAST_RESULT_LEN = out_len;
        }
    }
    out_ptr
}

/// # Safety
/// `ptr` must point to `len` valid UTF-8 bytes inside WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn wasm_count_words(ptr: *const u8, len: usize) -> usize {
    if ptr.is_null() || len == 0 {
        return 0;
    }
    // SAFETY: caller guarantees valid slice in linear memory.
    let bytes = unsafe { slice::from_raw_parts(ptr, len) };
    let Ok(input) = str::from_utf8(bytes) else {
        return 0;
    };
    count_normalized_words_rust(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lossless_reconstruction_and_contractions_match_ts_engine() {
        let sample = "Wait—don't \"give up\", ¿dónde está l'amour?";
        let tokens = tokenize_subtitle_rust(sample);
        let reconstructed: String = tokens.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(reconstructed, sample);

        let words: Vec<&str> = tokens
            .iter()
            .filter(|t| t.is_word)
            .map(|t| t.normalized.as_str())
            .collect();
        assert_eq!(
            words,
            vec!["wait", "don't", "give", "up", "dónde", "está", "l'amour"]
        );
    }
}
