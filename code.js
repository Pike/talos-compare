/* global URL, fetch */
const Treeherder = 'https://treeherder.mozilla.org/api/project/';
const tree = 'try';

let signatures, resultsets, Results = {}, revisions;

function onLoad() {
    revisions = new URL(document.location).searchParams.getAll('revision');
    let loading = [];
    let signatures_url = new URL(Treeherder + tree + '/performance/signatures/');
    signatures_url.searchParams.set('framework', 1);
    signatures_url.searchParams.set('subtests', 0);
    signatures_url.searchParams.set('interval', 604800);
    loading.push(fetch(signatures_url)
        .then(response => response.json()));
    revisions.forEach(function(revision) {
        let result_set_url = new URL(Treeherder + tree + '/resultset/');
        result_set_url.searchParams.set('revision', revision);
        loading.push(fetch(result_set_url)
            .then(response => response.json()));
    });
    Promise.all(loading).then(loadResults);
}

function loadResults(responses) {
    [signatures, ...resultsets] = responses;
    let resultset_ids = [];
    resultsets.forEach(function(rs) {
        rs.results.forEach(function (r) {resultset_ids.push(r.id);});
    });
    console.log(resultset_ids);
    let sigs = Object.keys(signatures);
    let loading = [];
    while (sigs.length) {
        let chunk = sigs.splice(0, 10);
        let results_url = new URL(Treeherder + tree + '/performance/data/');
        chunk.forEach(function(id) {
            results_url.searchParams.append('signatures', id);
        });
        resultset_ids.forEach(function(id) {
            results_url.searchParams.append('result_set_id', id);
        });
        results_url.searchParams.set('framework', 1);
        loading.push(fetch(results_url)
            .then(response => response.json())
            .then(function(talos_numbers) {
                Object.keys(talos_numbers).forEach(function(prop) {
                    Results[prop] = talos_numbers[prop];
                });
            }));
    }
    Promise.all(loading).then(renderResults);
    console.log('I think i am done');
}

function renderResults() {
    let body = document.querySelector("#container");
    body.innerHTML = '';
    let found_sigs = Object.keys(Results);
    let test_kinds = found_sigs.map(function(sig) {
        let test = signatures[sig];
        let seg = [test.test || test.suite, test.test_options ? test.test_options[0] : '', test.machine_platform, test, sig];
        return seg;
    });
    test_kinds.sort();
    test_kinds.forEach(function(t) {
        let [label, opts, platform, test, sig] = t;
        let row = document.createElement('tr');
        row.innerHTML = `<td>${label}${opts ? " (" + opts + ")" : ''}</td>`;
        body.appendChild(row);
    })
}

onLoad();
