#!/bin/bash
# Install required PHP extensions for WordPress

docker-php-ext-install mysqli pdo pdo_mysql
docker-php-ext-enable mysqli

# Install additional useful extensions
apt-get update
apt-get install -y \
    libfreetype6-dev \
    libjpeg62-turbo-dev \
    libpng-dev \
    libzip-dev

docker-php-ext-configure gd --with-freetype --with-jpeg
docker-php-ext-install -j$(nproc) gd zip exif

# Enable Apache modules
a2enmod rewrite
a2enmod headers
a2enmod expires