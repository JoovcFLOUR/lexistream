use criterion::{black_box, criterion_group, criterion_main, Criterion};
use lexistream_language_wasm::tokenize_subtitle_rust;

fn bench_subtitle_tokenization(c: &mut Criterion) {
    let short_cue = "I never thought this would happen, so don't give up now!";
    let dense_transcript = short_cue.repeat(200);

    c.bench_function("rust_tokenize_short_11_words", |b| {
        b.iter(|| tokenize_subtitle_rust(black_box(short_cue)))
    });

    c.bench_function("rust_tokenize_transcript_2200_words", |b| {
        b.iter(|| tokenize_subtitle_rust(black_box(&dense_transcript)))
    });
}

criterion_group!(benches, bench_subtitle_tokenization);
criterion_main!(benches);
