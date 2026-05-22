#!/bin/sh
set -eu

config_dir=/etc/searxng
settings_path="$config_dir/settings.yml"
limiter_path="$config_dir/limiter.toml"

mkdir -p "$config_dir"

if [ ! -f "$settings_path" ]
then
    secret_key="$(head -c 24 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')"
    cat > "$settings_path" <<EOF
use_default_settings:
    engines:
        remove:
            - ahmia
            - torch
            - wikidata

general:
    instance_name: Agent Room Search
    enable_metrics: false

search:
    formats:
        - html
        - json
    safe_search: 0

server:
    limiter: false
    public_instance: false
    secret_key: "$secret_key"
EOF
fi

if [ ! -f "$limiter_path" ]
then
    : > "$limiter_path"
fi

exec /usr/local/searxng/entrypoint.sh
