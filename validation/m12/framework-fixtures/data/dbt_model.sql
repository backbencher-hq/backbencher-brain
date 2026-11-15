{{ config(materialized='incremental') }}

SELECT
    id,
    total,
    created_at
FROM {{ ref('orders') }}
WHERE
    created_at >= (SELECT MAX(created_at) FROM {{ this }})
    AND id NOT IN (SELECT id FROM {{ source('raw', 'cancelled') }})
