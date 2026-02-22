use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use std::collections::HashMap;

use app_lib::executor::{
    build_execution_order, find_back_edges, hash_instructions, hash_pipeline,
    parse_cost_from_stderr, parse_structured_outputs, should_execute_edge, split_loop_items,
    NodeStatus,
};
use app_lib::pipeline_engine::{Pipeline, PipelineEdge, PipelineNode, Position};

// ---------------------------------------------------------------------------
// Data generators
// ---------------------------------------------------------------------------

fn make_node(id: &str, name: &str) -> PipelineNode {
    PipelineNode {
        id: id.into(),
        name: name.into(),
        node_type: "shell".into(),
        instructions: format!("echo {}", id),
        agent: None,
        inputs: vec![],
        outputs: vec![],
        retry: None,
        timeout: None,
        children: None,
        pipeline_ref: None,
        requires_tools: vec![],
        model: None,
        cache: false,
        loop_separator: None,
        max_iterations: None,
        position: Position { x: 0.0, y: 0.0 },
    }
}

fn make_edge(from: &str, to: &str) -> PipelineEdge {
    PipelineEdge {
        id: format!("{}->{}", from, to),
        from: from.into(),
        to: to.into(),
        condition: None,
    }
}

fn gen_linear_pipeline(n: usize) -> Pipeline {
    let nodes: Vec<PipelineNode> = (0..n).map(|i| make_node(&format!("n{i}"), &format!("Node {i}"))).collect();
    let edges: Vec<PipelineEdge> = (0..n.saturating_sub(1))
        .map(|i| make_edge(&format!("n{i}"), &format!("n{}", i + 1)))
        .collect();
    Pipeline {
        name: "bench".into(),
        description: "".into(),
        version: "1.0".into(),
        variables: HashMap::new(),
        nodes,
        edges,
        shared_session: true,
        default_model: None,
        max_cost_usd: None,
    }
}

fn gen_diamond_pipeline() -> Pipeline {
    // Creates a diamond: root -> 25 mid nodes -> sink (52 nodes total)
    let mut nodes = vec![make_node("root", "Root")];
    let mut edges = Vec::new();
    for i in 0..25 {
        let mid = format!("mid{i}");
        nodes.push(make_node(&mid, &format!("Mid {i}")));
        edges.push(make_edge("root", &mid));
        let child = format!("child{i}");
        nodes.push(make_node(&child, &format!("Child {i}")));
        edges.push(make_edge(&mid, &child));
        edges.push(make_edge(&child, "sink"));
    }
    nodes.push(make_node("sink", "Sink"));
    Pipeline {
        name: "diamond".into(),
        description: "".into(),
        version: "1.0".into(),
        variables: HashMap::new(),
        nodes,
        edges,
        shared_session: true,
        default_model: None,
        max_cost_usd: None,
    }
}

fn gen_stderr_lines(n: usize) -> Vec<String> {
    let mut lines: Vec<String> = (0..n.saturating_sub(1))
        .map(|i| format!("stderr line {i}: processing data..."))
        .collect();
    lines.push("Total cost: $0.0042".into());
    lines
}

fn gen_structured_output(field_count: usize) -> String {
    let fields: Vec<String> = (0..field_count)
        .map(|i| format!(r#""field_{i}": "value_{i}""#))
        .collect();
    format!(
        "Some output before\n--- OUTPUTS ---\n{{{}}}\nSome output after",
        fields.join(", ")
    )
}

// ---------------------------------------------------------------------------
// Benchmark groups
// ---------------------------------------------------------------------------

fn bench_parse_cost(c: &mut Criterion) {
    let mut group = c.benchmark_group("parse_cost");
    for size in [10, 100, 1000] {
        let lines = gen_stderr_lines(size);
        group.bench_with_input(BenchmarkId::new("lines", size), &lines, |b, lines| {
            b.iter(|| parse_cost_from_stderr(black_box(lines)));
        });
    }
    group.finish();
}

fn bench_hashing(c: &mut Criterion) {
    let mut group = c.benchmark_group("hashing");

    // hash_instructions with varying sizes
    let small = "echo hello"; // ~10 bytes
    let medium = "x".repeat(1024); // 1 KB
    let large = "x".repeat(102_400); // 100 KB
    group.bench_function("hash_instructions/10B", |b| {
        b.iter(|| hash_instructions(black_box(small)));
    });
    group.bench_function("hash_instructions/1KB", |b| {
        b.iter(|| hash_instructions(black_box(&medium)));
    });
    group.bench_function("hash_instructions/100KB", |b| {
        b.iter(|| hash_instructions(black_box(&large)));
    });

    // hash_pipeline with varying node counts
    for count in [5, 50, 200] {
        let pipeline = gen_linear_pipeline(count);
        group.bench_with_input(
            BenchmarkId::new("hash_pipeline", count),
            &pipeline,
            |b, p| {
                b.iter(|| hash_pipeline(black_box(p)));
            },
        );
    }

    group.finish();
}

fn bench_topology(c: &mut Criterion) {
    let mut group = c.benchmark_group("topology");

    // build_execution_order for linear pipelines
    for count in [10, 50, 100] {
        let pipeline = gen_linear_pipeline(count);
        group.bench_with_input(
            BenchmarkId::new("build_execution_order/linear", count),
            &pipeline,
            |b, p| {
                b.iter(|| build_execution_order(black_box(p)));
            },
        );
    }

    // Diamond topology (52 nodes)
    let diamond = gen_diamond_pipeline();
    group.bench_function("build_execution_order/diamond_52", |b| {
        b.iter(|| build_execution_order(black_box(&diamond)));
    });

    // find_back_edges for linear pipelines (no cycles)
    for count in [10, 50, 100] {
        let pipeline = gen_linear_pipeline(count);
        group.bench_with_input(
            BenchmarkId::new("find_back_edges/linear", count),
            &pipeline,
            |b, p| {
                b.iter(|| find_back_edges(black_box(p)));
            },
        );
    }

    group.bench_function("find_back_edges/diamond_52", |b| {
        b.iter(|| find_back_edges(black_box(&diamond)));
    });

    group.finish();
}

fn bench_structured_outputs(c: &mut Criterion) {
    let mut group = c.benchmark_group("structured_outputs");

    for count in [1, 5, 20] {
        let output = gen_structured_output(count);
        group.bench_with_input(
            BenchmarkId::new("parse", count),
            &output,
            |b, out| {
                b.iter(|| parse_structured_outputs(black_box(out)));
            },
        );
    }

    // No marker present — early exit path
    let no_marker = "Just some regular output without any marker";
    group.bench_function("parse/no_marker", |b| {
        b.iter(|| parse_structured_outputs(black_box(no_marker)));
    });

    group.finish();
}

fn bench_edge_conditions(c: &mut Criterion) {
    let mut group = c.benchmark_group("edge_conditions");

    let cases: Vec<(&str, Option<String>, NodeStatus)> = vec![
        ("none/success", None, NodeStatus::Success),
        ("none/failed", None, NodeStatus::Failed),
        ("success/success", Some("success".into()), NodeStatus::Success),
        ("success/failed", Some("success".into()), NodeStatus::Failed),
        ("failure/success", Some("failure".into()), NodeStatus::Success),
        ("failure/failed", Some("failure".into()), NodeStatus::Failed),
    ];

    for (name, condition, status) in &cases {
        group.bench_function(*name, |b| {
            b.iter(|| should_execute_edge(black_box(condition), black_box(status)));
        });
    }

    group.finish();
}

fn bench_split_loop_items(c: &mut Criterion) {
    let mut group = c.benchmark_group("split_loop_items");

    for count in [10, 100, 1000, 10000] {
        let source: String = (0..count)
            .map(|i| format!("item{}", i))
            .collect::<Vec<_>>()
            .join("\n");
        group.bench_with_input(
            BenchmarkId::new("newline", count),
            &source,
            |b, src| {
                b.iter(|| split_loop_items(black_box(src), None, None));
            },
        );
    }

    // Comma separator variant
    let comma_source: String = (0..1000)
        .map(|i| format!("item{}", i))
        .collect::<Vec<_>>()
        .join(",");
    group.bench_function("comma/1000", |b| {
        b.iter(|| split_loop_items(black_box(&comma_source), Some("comma"), None));
    });

    group.finish();
}

fn bench_topology_with_loop(c: &mut Criterion) {
    let mut group = c.benchmark_group("topology_with_loop");

    for child_count in [5, 25, 100] {
        let mut loop_node = make_node("loop1", "Loop");
        loop_node.node_type = "loop".into();
        let children: Vec<String> = (0..child_count).map(|i| format!("c{}", i)).collect();
        loop_node.children = Some(children.clone());

        let mut nodes = vec![loop_node];
        for cid in &children {
            nodes.push(make_node(cid, cid));
        }

        let pipeline = Pipeline {
            name: "loop_bench".into(),
            description: "".into(),
            version: "1.0".into(),
            variables: HashMap::new(),
            nodes,
            edges: vec![],
            shared_session: true,
            default_model: None,
            max_cost_usd: None,
        };

        group.bench_with_input(
            BenchmarkId::new("build_execution_order", child_count),
            &pipeline,
            |b, p| {
                b.iter(|| build_execution_order(black_box(p)));
            },
        );
    }

    group.finish();
}

fn bench_loop_variable_clone(c: &mut Criterion) {
    let mut group = c.benchmark_group("loop_variable_clone");

    for var_count in [5, 20, 50] {
        let vars: HashMap<String, String> = (0..var_count)
            .map(|i| (format!("VAR_{}", i), format!("value_{}", i)))
            .collect();

        group.bench_with_input(
            BenchmarkId::new("clone_and_insert", var_count),
            &vars,
            |b, vars| {
                b.iter(|| {
                    let mut cloned = vars.clone();
                    cloned.insert("LOOP_ITEM".to_string(), "test_item".to_string());
                    cloned.insert("LOOP_INDEX".to_string(), "0".to_string());
                    cloned.insert("LOOP_COUNT".to_string(), "10".to_string());
                    black_box(cloned);
                });
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_parse_cost,
    bench_hashing,
    bench_topology,
    bench_structured_outputs,
    bench_edge_conditions,
    bench_split_loop_items,
    bench_topology_with_loop,
    bench_loop_variable_clone,
);
criterion_main!(benches);
