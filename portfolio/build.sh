#!/bin/sh
# Wraps site.html (artifact-style page body) into a standalone index.html:
# everything up to the first </style> goes into <head>, the rest into <body>.
cd "$(dirname "$0")"
python3 - <<'PY'
s = open('site.html', encoding='utf-8').read()
i = s.index('</style>') + len('</style>')
head, body = s[:i], s[i:]
out = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
       + head + '\n</head>\n<body>' + body + '\n</body>\n</html>\n')
open('index.html', 'w', encoding='utf-8').write(out)
PY
