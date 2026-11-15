<?php

namespace App;

class StringUtil
{
    public static function upper(string $value): string
    {
        return strtoupper($value);
    }

    public static function slug(string $value): string
    {
        return strtolower(trim($value));
    }
}
